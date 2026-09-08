import { itemsById } from '@tibia-idle/data';
import { expForLevel } from '@tibia-idle/sim';

export function formatNumber(value: number): string {
  return Math.round(value).toLocaleString('pt-BR');
}

/** Compact Tibia-style rates: 80K, 1.2KK. */
export function formatRate(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}KK`;
  if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(abs >= 10_000 ? 0 : 1)}K`;
  return `${sign}${Math.round(abs)}`;
}

export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return [h, m, s].map((n) => String(n).padStart(2, '0')).join(':');
}

export function formatStamina(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function xpProgress(level: number, experience: number): { current: number; next: number; percent: number } {
  const current = expForLevel(level);
  const next = expForLevel(level + 1);
  const span = Math.max(1, next - current);
  return {
    current,
    next,
    percent: Math.min(100, Math.max(0, ((experience - current) / span) * 100)),
  };
}

export function staminaTone(minutes: number): 'high' | 'ok' | 'low' | 'empty' {
  if (minutes <= 0) return 'empty';
  if (minutes <= 840) return 'low';
  if (minutes > 2340) return 'high';
  return 'ok';
}

export type ItemRarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';

/** Visual rarity from NPC sell value — the same number the pouch uses. */
export function itemRarity(itemId: number): ItemRarity {
  const value = itemsById.get(itemId)?.sellPrice ?? 0;
  if (value >= 50_000) return 'legendary';
  if (value >= 10_000) return 'epic';
  if (value >= 1_000) return 'rare';
  if (value >= 100) return 'uncommon';
  return 'common';
}

export function itemValue(itemId: number): number {
  return itemsById.get(itemId)?.sellPrice ?? 0;
}
