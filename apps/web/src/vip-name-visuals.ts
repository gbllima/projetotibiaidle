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
    // Keep the small Tibia-style label readable while giving VIP characters a
    // warmer, premium gold treatment. The animation below only changes the
    // fill occasionally, avoiding a costly Pixi text re-raster every frame.
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
    const vip = vipNames.has(key(node.textContent ?? ''));
    node.classList.toggle('vip-chat-name', vip);
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
      color: #ffd447 !important;
      font-weight: 800 !important;
      text-shadow:
        -1px -1px 0 #000,
         1px -1px 0 #000,
        -1px  1px 0 #000,
         1px  1px 0 #000,
         0 0 4px rgba(255, 190, 35, .84),
         0 0 8px rgba(255, 157, 0, .42) !important;
    }

    @supports ((background-clip: text) or (-webkit-background-clip: text)) {
      .chat-line.say b.vip-chat-name {
        background-image: linear-gradient(
          110deg,
          #d49300 0%,
          #f1b91f 27%,
          #ffd447 40%,
          #fff1a1 47%,
          #fffdf1 50%,
          #fff0a0 53%,
          #ffd447 61%,
          #e4a80d 76%,
          #d49300 100%
        );
        background-size: 245% 100%;
        background-position: 135% 50%;
        background-repeat: no-repeat;
        -webkit-background-clip: text;
        background-clip: text;
        -webkit-text-fill-color: transparent;
        color: transparent !important;
        filter:
          drop-shadow(-1px 0 0 #000)
          drop-shadow(1px 0 0 #000)
          drop-shadow(0 -1px 0 #000)
          drop-shadow(0 1px 0 #000)
          drop-shadow(0 0 2px rgba(255, 185, 28, .78));
        animation: vip-chat-name-shimmer 2.8s ease-in-out infinite;
      }
    }

    @keyframes vip-chat-name-shimmer {
      0%, 18% {
        background-position: 135% 50%;
      }
      62%, 100% {
        background-position: -55% 50%;
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .chat-line.say b.vip-chat-name {
        animation: none !important;
        background: none !important;
        -webkit-text-fill-color: #ffd447 !important;
        color: #ffd447 !important;
        filter: none !important;
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

  // Alpha is cheap to animate every frame. The actual Pixi text fill is updated
  // at ~11 fps and only when the quantized color changes, so the gleam remains
  // visible without forcing every VIP name texture to rebuild at 60 fps.
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
