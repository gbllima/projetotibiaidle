import { useMemo, useRef, useState } from 'react';
import {
  ROULETTE_MAX_LEVEL,
  ROULETTE_MIN_LEVEL,
  equipLevelRequired,
  roulettePool,
} from '@tibia-idle/sim';
import { itemsById } from '@tibia-idle/data';
import { ApiError } from '../api/client.js';
import type { CharacterView } from '../api/types.js';
import { ItemSlot } from './ItemSlot.js';

const SLOT_WIDTH = 68;
const SPIN_LEAD = 28;
const SPIN_TAIL = 5;
const SPIN_MS = 4200;

function pickRandomId(ids: number[]): number {
  return ids[Math.floor(Math.random() * ids.length)]!;
}

function buildSpinStrip(poolIds: number[], winnerId: number): number[] {
  const strip: number[] = [];
  for (let i = 0; i < SPIN_LEAD; i += 1) strip.push(pickRandomId(poolIds));
  strip.push(winnerId);
  for (let i = 0; i < SPIN_TAIL; i += 1) strip.push(pickRandomId(poolIds));
  return strip;
}

function blockReason(character: CharacterView, poolSize: number, busy: boolean, spinning: boolean): string | null {
  if (spinning) return null;
  if (busy) return 'Aguarde a ação anterior terminar.';
  if (poolSize <= 0) return 'Nenhum item disponível para sua vocação.';
  if ((character.rouletteTickets ?? 0) < 1) {
    return 'Precisa de 1 Ticket de Roleta. Ganhe um ao completar o 7º Daily.';
  }
  return null;
}

export function RoulettePanel({
  character,
  busy,
  onAct,
}: {
  character: CharacterView;
  busy: boolean;
  onAct: (body: Record<string, unknown>) => Promise<Record<string, unknown>>;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [spinning, setSpinning] = useState(false);
  const [offset, setOffset] = useState(0);
  const [strip, setStrip] = useState<number[]>([]);
  const [transition, setTransition] = useState(false);
  const [prize, setPrize] = useState<{ itemId: number; name: string; level: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pool = useMemo(() => roulettePool(character.vocation.id), [character.vocation.id]);
  const poolIds = useMemo(() => pool.map((item) => item.id), [pool]);

  const previewStrip = useMemo(() => {
    if (!poolIds.length) return [];
    const slice = poolIds.slice(0, Math.min(poolIds.length, 12));
    return [...slice, ...slice, ...slice];
  }, [poolIds]);

  const blocked = blockReason(character, pool.length, busy, spinning);
  const canSpin = !blocked && !spinning;

  const animateToWinner = (winnerId: number) =>
    new Promise<void>((resolve) => {
      const nextStrip = buildSpinStrip(poolIds, winnerId);
      const viewport = viewportRef.current;
      const viewWidth = viewport?.clientWidth ?? SLOT_WIDTH * 5;
      const winIndex = SPIN_LEAD;
      const target = winIndex * SLOT_WIDTH - (viewWidth - SLOT_WIDTH) / 2;

      setTransition(false);
      setOffset(0);
      setStrip(nextStrip);

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setTransition(true);
          setOffset(target);
        });
      });

      window.setTimeout(() => {
        setTransition(false);
        resolve();
      }, SPIN_MS + 80);
    });

  const spin = async () => {
    const reason = blockReason(character, pool.length, busy, spinning);
    if (reason) {
      setError(reason);
      return;
    }
    setSpinning(true);
    setPrize(null);
    setError(null);
    try {
      const result = await onAct({ type: 'roleta-spin' });
      const itemId = Number(result.itemId);
      if (!Number.isFinite(itemId) || itemId <= 0) {
        throw new ApiError('Resposta inválida do servidor — reinicie o servidor (pnpm dev).', 500);
      }
      await animateToWinner(itemId);
      const item = itemsById.get(itemId);
      setPrize({
        itemId,
        name: String(result.itemName ?? item?.name ?? 'Item'),
        level: Number(result.levelRequired ?? (item ? equipLevelRequired(item) : 0)),
      });
    } catch (err) {
      setStrip([]);
      setOffset(0);
      setError(err instanceof ApiError ? err.message : 'Não foi possível girar a roleta.');
    } finally {
      setSpinning(false);
    }
  };

  const displayStrip = strip.length ? strip : previewStrip;

  return (
    <div className="roleta-panel">
      <p className="roleta-lede">
        Roleta da vocação <strong>{character.vocation.name}</strong> — itens de nível{' '}
        {ROULETTE_MIN_LEVEL} a {ROULETTE_MAX_LEVEL}. Prêmio vai direto pro <strong>Depot</strong>.
      </p>
      <p className="roleta-meta">
        {pool.length.toLocaleString('pt-BR')} itens elegíveis · {character.rouletteTickets ?? 0} ticket(s)
      </p>

      <div className="roleta-stage">
        <div className="roleta-pointer" aria-hidden />
        <div className="roleta-viewport" ref={viewportRef}>
          <div
            className={`roleta-track${transition ? ' animating' : ''}`}
            style={{ transform: `translateX(${-offset}px)` }}
          >
            {displayStrip.map((itemId, index) => {
              const item = itemsById.get(itemId);
              return (
                <div className="roleta-slot" key={`${itemId}-${index}`}>
                  <ItemSlot itemId={itemId} label={item?.name} compact />
                  {item && (
                    <span className="roleta-slot-level">Lv {equipLevelRequired(item)}</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {prize && (
        <p className="roleta-result">
          Você ganhou <strong>{prize.name}</strong> (Lv {prize.level}) — enviado ao Depot.
        </p>
      )}

      {error && <p className="roleta-error">{error}</p>}

      <div className="roleta-actions">
        <button type="button" className="btn gold roleta-spin-btn" disabled={!canSpin} onClick={() => void spin()}>
          {spinning ? 'Girando…' : 'Girar · 1 Ticket'}
        </button>
      </div>

      {blocked && !spinning && !error && (
        <p className="roleta-hint">{blocked}</p>
      )}
    </div>
  );
}
