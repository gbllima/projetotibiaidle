import type { AccountView, BossView, CharacterView, HuntView, LobbyPlayer, Settlement, WorldView } from './types.js';

const TOKEN_KEY = 'tibia-idle.token';

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'ApiError';
  }
}

export function storedToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function storeToken(token: string | null): void {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const token = storedToken();
  const response = await fetch(url, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await response.text();
  let payload: Record<string, unknown> = {};
  if (text) {
    try { payload = JSON.parse(text) as Record<string, unknown>; } catch { payload = {}; }
  }
  if (!response.ok) {
    const raw = String(payload['error'] ?? '');
    const fallback = response.status === 502 || response.status === 500
      ? 'Servidor offline. Aguarde alguns segundos ou reinicie com pnpm dev.'
      : response.status === 404 && url.startsWith('/api/')
        ? 'API indisponível na porta 3000. Pare o servidor antigo e rode: pnpm --filter @tibia-idle/server dev'
        : response.statusText;
    throw new ApiError(raw || fallback, response.status);
  }
  return payload as T;
}

export interface HealthView {
  ok: boolean;
  tickMs: number;
  maxOfflineHours: number;
  content: Record<string, number>;
  generatedAt: string;
  beta: 'open' | 'closed';
}

async function startConfiguredPartyHunt(id: number, huntId: string, hours?: number): Promise<{ character: CharacterView }> {
  const started = await request<{ character: CharacterView }>('POST', `/api/characters/${id}/hunt`, { huntId, hours });
  const ids = started.character.partyMemberIds ?? [id];
  if (ids[0] !== id || ids.length <= 1) return started;

  for (const memberId of ids.slice(1)) {
    const current = await request<{ character: CharacterView; settlement: Settlement }>('GET', `/api/characters/${memberId}`);
    if (current.character.session?.huntId === huntId && current.character.session.status === 'active') continue;

    if (current.character.session || current.character.queue) {
      try {
        await request<{ character: CharacterView; goldBanked: number; supplyRefund: number }>('DELETE', `/api/characters/${memberId}/hunt`);
      } catch (error) {
        if (!(error instanceof ApiError) || error.status !== 409) throw error;
      }
    }

    await request<{ character: CharacterView }>('POST', `/api/characters/${memberId}/hunt`, { huntId, hours });
  }

  return request<{ character: CharacterView; settlement: Settlement }>('GET', `/api/characters/${id}`)
    .then(({ character }) => ({ character }));
}

export const api = {
  health: () => request<HealthView>('GET', '/api/health'),
  register: (username: string, password: string, invite?: string) => request<{ token: string; accountId: number; username: string; guest?: boolean }>('POST', '/api/register', { username, password, invite }),
  guest: () => request<{ token: string; accountId: number; username: string; guest?: boolean }>('POST', '/api/guest'),
  claim: (username: string, password: string) => request<{ token: string; accountId: number; username: string; guest?: boolean }>('POST', '/api/claim', { username, password }),
  login: (username: string, password: string) => request<{ token: string; accountId: number; username: string; guest?: boolean }>('POST', '/api/login', { username, password }),
  logout: () => request<{ ok: boolean }>('POST', '/api/logout'),
  characters: () => request<{ characters: CharacterView[]; account: AccountView }>('GET', '/api/characters'),
  lobby: () => request<{ players: LobbyPlayer[] }>('GET', '/api/lobby'),
  createCharacter: (name: string, vocationId: number, extras?: { gender?: 'm' | 'f'; weapon?: string }) => request<{ character: CharacterView }>('POST', '/api/characters', { name, vocationId, ...extras }),
  character: (id: number) => request<{ character: CharacterView; settlement: Settlement }>('GET', `/api/characters/${id}`),
  addPartyMember: (ownerId: number, characterId: number) => request<{ character: CharacterView }>('POST', `/api/characters/${ownerId}/party/members`, { characterId }),
  configureParty: (ownerId: number, memberIds: number[], primaryId: number) => request<{ character: CharacterView }>('PUT', `/api/characters/${ownerId}/party`, { memberIds, primaryId }),
  removePartyMember: (ownerId: number, characterId: number) => request<{ character: CharacterView }>('DELETE', `/api/characters/${ownerId}/party/members/${characterId}`),
  hunts: (id: number) => request<{ hunts: HuntView[] }>('GET', `/api/characters/${id}/hunts`),
  bosses: (id: number) => request<{ bosses: BossView[] }>('GET', `/api/characters/${id}/bosses`),
  startHunt: startConfiguredPartyHunt,
  stopHunt: (id: number) => request<{ character: CharacterView; goldBanked: number; supplyRefund: number }>('DELETE', `/api/characters/${id}/hunt`),
  upgradeGear: (id: number) => request<{ character: CharacterView; spent: number }>('POST', `/api/characters/${id}/gear`),
  sellPouch: (id: number) => request<{ character: CharacterView; gold: number }>('POST', `/api/characters/${id}/sell`),
  stashPouch: (id: number) => request<{ character: CharacterView; items: number }>('POST', `/api/characters/${id}/stash`),
  act: (id: number, body: Record<string, unknown>) => request<{ character: CharacterView; targetCharacter?: CharacterView } & Record<string, unknown>>('POST', `/api/characters/${id}/act`, body),
  world: (channel = 'geral') => request<WorldView>('GET', `/api/world?channel=${encodeURIComponent(channel)}`),
  admin: () => request<{
    accounts: Array<{ id: number; username: string; admin: boolean; characters: Array<{ id: number; name: string; level: number; gold: number; coins: number }> }>;
    orders: Array<{ id: number; accountId: number; packId: string; coins: number; brl: number; status: string; createdAt: number }>;
    event: { name: string; experience: number; loot: number };
    metrics: { accounts: number; characters: number; hunting: number; queued: number; gold: number; coins: number; beta: string; last24h: { dau: number; registers: number; huntsStarted: number; huntsStopped: number; goldFromHunts: number }; retention: { d1Cohort: number; d1Returned: number; d1: number | null }; topHunts: Array<{ huntId: string; n: number }> };
    invites: Array<{ code: string; usedBy: number | null }>;
  }>('GET', '/api/admin'),
  adminAct: (body: Record<string, unknown>) => request<Record<string, unknown>>('POST', '/api/admin', body),
};

export class LiveSocket {
  private socket: WebSocket | null = null;
  private retry = 0;
  private closed = false;
  private timer: number | null = null;

  constructor(
    private readonly characterId: number,
    private readonly onState: (character: CharacterView, settlement: Settlement) => void,
    private readonly onStatus: (status: 'connecting' | 'open' | 'closed') => void,
  ) { this.connect(); }

  private connect(): void {
    if (this.closed) return;
    this.onStatus('connecting');
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(`${protocol}//${location.host}/ws`);
    this.socket = socket;
    socket.addEventListener('open', () => {
      this.retry = 0;
      this.onStatus('open');
      socket.send(JSON.stringify({ type: 'subscribe', token: storedToken(), characterId: this.characterId }));
    });
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data)) as { type: string; character?: CharacterView; settlement?: Settlement };
      if (message.type === 'state' && message.character) this.onState(message.character, message.settlement ?? { elapsedSeconds: 0, stoppedBecause: null });
    });
    socket.addEventListener('close', () => {
      this.onStatus('closed');
      if (this.closed) return;
      const delay = Math.min(30_000, 500 * 2 ** this.retry);
      this.retry += 1;
      this.timer = window.setTimeout(() => this.connect(), delay);
    });
  }

  close(): void {
    this.closed = true;
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.socket?.close();
  }
}
