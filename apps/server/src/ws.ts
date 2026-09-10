import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import type { Database } from './db.js';
import { loadCharacter } from './game.js';
import { economyCharacterView, syncAccountEconomy } from './economy.js';
import { markOffline, markOnline } from './presence.js';
import { publicSettlement } from './settle.js';

/**
 * Live session updates.
 *
 * The browser runs its own copy of the simulation for animation, so this socket
 * carries state snapshots rather than a blow-by-blow event stream. A snapshot
 * every couple of seconds is enough to correct any drift and costs a fraction
 * of the bandwidth, and because both sides run the same deterministic code from
 * the same seed there is normally nothing to correct.
 */

const PUSH_INTERVAL_MS = 2000;

interface Subscription {
  socket: WebSocket;
  accountId: number;
  characterId: number;
  timer: NodeJS.Timeout;
}

export function registerWebSocket(app: FastifyInstance, db: Database): void {
  const subscriptions = new Set<Subscription>();

  const stop = (subscription: Subscription): void => {
    clearInterval(subscription.timer);
    subscriptions.delete(subscription);
  };

  app.get('/ws', { websocket: true }, (socket) => {
    let subscription: Subscription | null = null;

    const send = (payload: unknown): void => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(payload));
    };

    const push = (): void => {
      if (!subscription) return;
      try {
        const { loaded, settlement } = loadCharacter(db, subscription.accountId, subscription.characterId);
        syncAccountEconomy(db, subscription.accountId, loaded);
        send({
          type: 'state',
          character: {
            ...economyCharacterView(db, subscription.accountId, loaded),
            partyEvents: loaded.partyEvents ?? [],
          },
          settlement: publicSettlement(settlement),
        });
      } catch (error) {
        send({ type: 'error', error: (error as Error).message });
        if (subscription) stop(subscription);
        subscription = null;
      }
    };

    socket.on('message', (raw: Buffer) => {
      let message: { type?: string; token?: string; characterId?: number };
      try {
        message = JSON.parse(raw.toString()) as typeof message;
      } catch {
        send({ type: 'error', error: 'Expected JSON.' });
        return;
      }

      if (message.type !== 'subscribe') {
        send({ type: 'error', error: 'Unknown message type.' });
        return;
      }

      const accountId = message.token ? db.accountIdForToken(message.token) : null;
      if (accountId === null) {
        send({ type: 'error', error: 'Invalid token.' });
        socket.close();
        return;
      }
      const characterId = Number(message.characterId);
      if (!Number.isInteger(characterId)) {
        send({ type: 'error', error: 'Missing characterId.' });
        return;
      }

      if (subscription) {
        markOffline(subscription.characterId);
        stop(subscription);
      }
      subscription = {
        socket,
        accountId,
        characterId,
        timer: setInterval(() => push(), PUSH_INTERVAL_MS),
      };
      subscriptions.add(subscription);
      markOnline(characterId);
      push();
    });

    socket.on('close', () => {
      if (subscription) {
        markOffline(subscription.characterId);
        stop(subscription);
      }
      subscription = null;
    });
  });

  app.addHook('onClose', async () => {
    for (const subscription of subscriptions) clearInterval(subscription.timer);
    subscriptions.clear();
  });
}
