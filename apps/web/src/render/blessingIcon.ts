/** Tibia blessing bitmask ids (Crystal server ids 2–32). */
export const BLESSING_BIT = [2, 4, 8, 16, 32] as const;

const BLESSING_HUES = [205, 24, 45, 270, 145] as const;
const cache = new Map<string, string>();

function drawBlessingIcon(ctx: CanvasRenderingContext2D, index: number, active: boolean, size: number): void {
  const hue = BLESSING_HUES[index] ?? 45;
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = '#1a1410';
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = active ? `hsl(${hue}, 78%, 62%)` : '#4a4540';
  ctx.lineWidth = Math.max(1, size / 32);
  ctx.strokeRect(1, 1, size - 2, size - 2);

  const cx = size / 2;
  const cy = size / 2;
  const r = size * 0.28;
  ctx.fillStyle = active ? `hsl(${hue}, 70%, ${index === 2 ? 58 : 52}%)` : '#3a3530';
  ctx.beginPath();
  if (index === 0) {
    ctx.rect(cx - r, cy - r * 1.1, r * 1.8, r * 2.1);
    ctx.fill();
    ctx.strokeStyle = active ? '#d8ecff' : '#555';
    ctx.strokeRect(cx - r * 0.55, cy - r * 0.65, r * 1.1, r * 1.35);
  } else if (index === 1) {
    ctx.moveTo(cx, cy - r * 1.2);
    ctx.bezierCurveTo(cx + r * 1.4, cy - r * 0.2, cx + r * 0.8, cy + r * 1.2, cx, cy + r * 0.7);
    ctx.bezierCurveTo(cx - r * 0.8, cy + r * 1.2, cx - r * 1.4, cy - r * 0.2, cx, cy - r * 1.2);
    ctx.fill();
  } else if (index === 2) {
    for (let i = 0; i < 8; i += 1) {
      const a = (Math.PI * 2 * i) / 8;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(a) * r * 1.25, cy + Math.sin(a) * r * 1.25);
      ctx.lineWidth = Math.max(1.5, size / 22);
      ctx.strokeStyle = active ? `hsl(${hue}, 90%, 65%)` : '#555';
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.55, 0, Math.PI * 2);
    ctx.fill();
  } else if (index === 3) {
    ctx.moveTo(cx, cy - r * 1.1);
    ctx.lineTo(cx + r * 1.05, cy - r * 0.1);
    ctx.lineTo(cx + r * 0.65, cy + r * 1.05);
    ctx.lineTo(cx - r * 0.65, cy + r * 1.05);
    ctx.lineTo(cx - r * 1.05, cy - r * 0.1);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = active ? '#e8dcff' : '#444';
    ctx.fillRect(cx - r * 0.18, cy - r * 0.55, r * 0.36, r * 0.95);
  } else {
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = active ? '#ffe8a8' : '#444';
    ctx.beginPath();
    ctx.moveTo(cx, cy - r * 0.55);
    ctx.lineTo(cx + r * 0.48, cy - r * 0.05);
    ctx.lineTo(cx + r * 0.32, cy + r * 0.55);
    ctx.lineTo(cx - r * 0.32, cy + r * 0.55);
    ctx.lineTo(cx - r * 0.48, cy - r * 0.05);
    ctx.closePath();
    ctx.fill();
  }
}

function drawButtonIcon(ctx: CanvasRenderingContext2D, tone: 'grey' | 'gold', size: number): void {
  ctx.clearRect(0, 0, size, size);
  const base = tone === 'gold' ? '#3a3018' : '#252525';
  const edge = tone === 'gold' ? '#c9a227' : '#5a5a5a';
  const glow = tone === 'gold' ? '#f7d774' : '#8a8a8a';
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = edge;
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, size - 1, size - 1);
  const cx = size / 2;
  const cy = size / 2;
  ctx.strokeStyle = glow;
  ctx.lineWidth = Math.max(1, size / 10);
  ctx.beginPath();
  ctx.moveTo(cx, cy - size * 0.28);
  ctx.lineTo(cx, cy + size * 0.22);
  ctx.moveTo(cx - size * 0.18, cy - size * 0.05);
  ctx.lineTo(cx + size * 0.18, cy - size * 0.05);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy + size * 0.24, size * 0.16, Math.PI, 0);
  ctx.stroke();
}

function toDataUrl(draw: (ctx: CanvasRenderingContext2D) => void, size: number): string {
  const key = `${size}-${draw.toString().slice(0, 24)}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  draw(ctx);
  const url = canvas.toDataURL('image/png');
  cache.set(key, url);
  return url;
}

export function blessingRecordIcon(index: number, active: boolean): string {
  const cacheKey = `record-${index}-${active ? 1 : 0}`;
  const hit = cache.get(cacheKey);
  if (hit) return hit;
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  drawBlessingIcon(ctx, index, active, 64);
  const url = canvas.toDataURL('image/png');
  cache.set(cacheKey, url);
  return url;
}

export function blessingSetButtonIcon(tone: 'grey' | 'gold', size = 20): string {
  const cacheKey = `btn-${tone}-${size}`;
  const hit = cache.get(cacheKey);
  if (hit) return hit;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  drawButtonIcon(ctx, tone, size);
  const url = canvas.toDataURL('image/png');
  cache.set(cacheKey, url);
  return url;
}
