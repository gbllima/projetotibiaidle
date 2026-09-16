import { CombatScene } from './render/combat.js';

const VIP_GOLD = 0xffd447;
const VIP_SHINE = 0xfff4b0;
const VIP_STROKE = 0x000000;
const VIP_REFRESH_MS = 5_000;
const VIP_WORLD_SHIMMER_MS = 2_800;
const VIP_WORLD_FRAME_MS = 90;

type VipPlayer = { id: number; name: string };
type LabelLike = {
  destroyed?: boolean;
  alpha: number;
  text?: string;
  style?: Record<string, unknown>;
};
type SpriteEntryLike = { label?: LabelLike };
type SceneLike = {
  dead?: boolean;
  player?: SpriteEntryLike | null;
  allies?: Map<string, SpriteEntryLike>;
};
type PlayerLike = { id?: number; name: string };

type SavedStyle = {
  fill: unknown;
  stroke: unknown;
  dropShadow: unknown;
  alpha: number;
};

let vipNames = new Set<string>();
let lastWorldShimmerAt = 0;
const trackedScenes = new Set<CombatScene>();
const sceneViews = new WeakMap<CombatScene, { player: PlayerLike; allies: PlayerLike[] }>();
const savedStyles = new WeakMap<object, SavedStyle>();
const glowingLabels = new Set<LabelLike>();
const lastAnimatedFill = new WeakMap<object, number>();

function key(name: string): string {
  return name.trim().toLocaleLowerCase('pt-BR');
}

function isVip(player: PlayerLike | undefined): boolean {
  return Boolean(player?.name && vipNames.has(key(player.name)));
}

function remember(label: LabelLike): SavedStyle {
  const existing = savedStyles.get(label as object);
  if (existing) return existing;
  const style = label.style ?? {};
  const saved: SavedStyle = {
    fill: style['fill'],
    stroke: style['stroke'],
    dropShadow: style['dropShadow'],
    alpha: label.alpha,
  };
  savedStyles.set(label as object, saved);
  return saved;
}

function paintLabel(label: LabelLike | undefined, vip: boolean): void {
  if (!label || label.destroyed || !label.style) return;
  const base = remember(label);
  const style = label.style;

  if (vip) {
    style['fill'] = VIP_GOLD;
    style['stroke'] = { color: VIP_STROKE, width: 1.35, join: 'round' };
    style['dropShadow'] = {
      color: 0xffbd2e,
      alpha: 0.72,
      blur: 1.75,
      distance: 0,
      angle: 0,
    };
    lastAnimatedFill.set(label as object, VIP_GOLD);
    glowingLabels.add(label);
    return;
  }

  style['fill'] = base.fill;
  style['stroke'] = base.stroke;
  style['dropShadow'] = base.dropShadow;
  label.alpha = base.alpha;
  lastAnimatedFill.delete(label as object);
  glowingLabels.delete(label);
}

function repaintScene(scene: CombatScene): void {
  const internal = scene as unknown as SceneLike;
  if (internal.dead) {
    trackedScenes.delete(scene);
    return;
  }

  const views = sceneViews.get(scene);
  if (!views) return;
  paintLabel(internal.player?.label, isVip(views.player));

  for (const entry of internal.allies?.values() ?? []) {
    const name = String(entry.label?.text ?? '');
    const view = views.allies.find((candidate) => key(candidate.name) === key(name));
    paintLabel(entry.label, isVip(view));
  }
}

function repaintScenes(): void {
  for (const scene of [...trackedScenes]) repaintScene(scene);
}

function decorateChat(): void {
  document.querySelectorAll<HTMLElement>('.chat-line.say b').forEach((node) => {
    const name = (node.textContent ?? '').trim();
    const vip = vipNames.has(key(name));
    node.classList.toggle('vip-chat-name', vip);
    if (vip) node.dataset.vipName = name;
    else delete node.dataset.vipName;
  });
}

async function refreshVipNames(): Promise<void> {
  try {
    const response = await fetch('/api/vip-visuals', { cache: 'no-store' });
    if (!response.ok) return;
    const payload = await response.json() as { players?: VipPlayer[] };
    vipNames = new Set((payload.players ?? []).map((player) => key(player.name)));
    repaintScenes();
    decorateChat();
  } catch {
    // Visual enhancement only; a temporary request failure must never affect gameplay.
  }
}

const originalSync = CombatScene.prototype.sync;
CombatScene.prototype.sync = function vipAwareSync(active, player, allies = []) {
  originalSync.call(this, active, player, allies);
  trackedScenes.add(this);
  sceneViews.set(this, { player, allies });
  repaintScene(this);
};

function installChatStyle(): void {
  if (document.getElementById('vip-name-visual-style')) return;
  const style = document.createElement('style');
  style.id = 'vip-name-visual-style';
  style.textContent = `
    .chat-line.say b.vip-chat-name {
      display: inline-block;
      position: relative;
      isolation: isolate;
      overflow: visible;
      color: #ffd447 !important;
      font-weight: 800 !important;
      text-shadow:
        -1px -1px 0 #000,
         1px -1px 0 #000,
        -1px  1px 0 #000,
         1px  1px 0 #000,
         0 0 3px rgba(255, 190, 35, .95),
         0 0 7px rgba(255, 157, 0, .58) !important;
      animation: vip-chat-base-glow 2.4s ease-in-out infinite;
    }

    .chat-line.say b.vip-chat-name::after {
      content: attr(data-vip-name);
      position: absolute;
      inset: 0;
      z-index: 1;
      pointer-events: none;
      white-space: nowrap;
      color: #fffbe0;
      font: inherit;
      font-weight: 900;
      letter-spacing: inherit;
      text-shadow:
        0 0 2px #fff8bf,
        0 0 5px rgba(255, 225, 110, .95),
        0 0 8px rgba(255, 174, 25, .7);
      opacity: 0;
      clip-path: polygon(0 0, 0 0, 0 100%, 0 100%);
      animation: vip-chat-reflection 2.35s linear infinite;
      will-change: clip-path, opacity;
    }

    @keyframes vip-chat-base-glow {
      0%, 100% {
        color: #f2bd2a;
        text-shadow:
          -1px -1px 0 #000,
           1px -1px 0 #000,
          -1px  1px 0 #000,
           1px  1px 0 #000,
           0 0 2px rgba(255, 173, 24, .72),
           0 0 5px rgba(255, 142, 0, .38);
      }
      50% {
        color: #ffdb58;
        text-shadow:
          -1px -1px 0 #000,
           1px -1px 0 #000,
          -1px  1px 0 #000,
           1px  1px 0 #000,
           0 0 4px rgba(255, 204, 65, .98),
           0 0 8px rgba(255, 157, 0, .58);
      }
    }

    @keyframes vip-chat-reflection {
      0%, 18% {
        opacity: 0;
        clip-path: polygon(0 0, 0 0, 0 100%, 0 100%);
      }
      24% {
        opacity: 1;
        clip-path: polygon(0 0, 16% 0, 28% 100%, 10% 100%);
      }
      54% {
        opacity: 1;
        clip-path: polygon(72% 0, 88% 0, 100% 100%, 82% 100%);
      }
      60%, 100% {
        opacity: 0;
        clip-path: polygon(100% 0, 100% 0, 100% 100%, 100% 100%);
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .chat-line.say b.vip-chat-name {
        animation: none !important;
        color: #ffd447 !important;
      }
      .chat-line.say b.vip-chat-name::after {
        display: none !important;
      }
    }
  `;
  document.head.appendChild(style);
}

function startChatObserver(): void {
  const root = document.getElementById('root') ?? document.body;
  if (!root) return;
  const observer = new MutationObserver(decorateChat);
  observer.observe(root, { childList: true, subtree: true, characterData: true });
  decorateChat();
}

function mixColor(from: number, to: number, amount: number): number {
  const t = Math.max(0, Math.min(1, amount));
  const fr = (from >> 16) & 0xff;
  const fg = (from >> 8) & 0xff;
  const fb = from & 0xff;
  const tr = (to >> 16) & 0xff;
  const tg = (to >> 8) & 0xff;
  const tb = to & 0xff;
  const r = Math.round(fr + (tr - fr) * t);
  const g = Math.round(fg + (tg - fg) * t);
  const b = Math.round(fb + (tb - fb) * t);
  return (r << 16) | (g << 8) | b;
}

function shimmerOffset(text: string): number {
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) hash = ((hash << 5) - hash + text.charCodeAt(index)) | 0;
  return Math.abs(hash % VIP_WORLD_SHIMMER_MS);
}

function animateGlow(time: number): void {
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

  for (const label of [...glowingLabels]) {
    if (label.destroyed) {
      glowingLabels.delete(label);
      continue;
    }
    const pulse = reducedMotion ? 1 : 0.97 + ((Math.sin((time + shimmerOffset(String(label.text ?? ''))) / 420) + 1) / 2) * 0.03;
    label.alpha = pulse;
  }

  if (!reducedMotion && time - lastWorldShimmerAt >= VIP_WORLD_FRAME_MS) {
    lastWorldShimmerAt = time;
    for (const label of glowingLabels) {
      if (label.destroyed || !label.style) continue;
      const progress = ((time + shimmerOffset(String(label.text ?? ''))) % VIP_WORLD_SHIMMER_MS) / VIP_WORLD_SHIMMER_MS;
      const distance = Math.abs(progress - 0.5);
      const rawShine = Math.max(0, 1 - distance / 0.09);
      const shine = Math.round(rawShine * 4) / 4;
      const fill = mixColor(VIP_GOLD, VIP_SHINE, shine);
      if (lastAnimatedFill.get(label as object) !== fill) {
        label.style['fill'] = fill;
        lastAnimatedFill.set(label as object, fill);
      }
    }
  }

  window.requestAnimationFrame(animateGlow);
}

installChatStyle();
startChatObserver();
void refreshVipNames();
window.setInterval(() => { void refreshVipNames(); }, VIP_REFRESH_MS);
window.requestAnimationFrame(animateGlow);
