import { CombatScene } from './render/combat.js';

const VIP_GOLD = 0xffd447;
const VIP_STROKE = 0x000000;
const VIP_REFRESH_MS = 5_000;

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
const trackedScenes = new Set<CombatScene>();
const sceneViews = new WeakMap<CombatScene, { player: PlayerLike; allies: PlayerLike[] }>();
const savedStyles = new WeakMap<object, SavedStyle>();
const glowingLabels = new Set<LabelLike>();

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
    // Strong black outline keeps the small Tibia-style font crisp over bright
    // floors, outfits and spell effects. The gold glow is intentionally softer
    // than before so it does not wash out the glyphs.
    style['fill'] = VIP_GOLD;
    style['stroke'] = { color: VIP_STROKE, width: 1.35, join: 'round' };
    style['dropShadow'] = {
      color: 0xffbd2e,
      alpha: 0.72,
      blur: 1.75,
      distance: 0,
      angle: 0,
    };
    glowingLabels.add(label);
    return;
  }

  style['fill'] = base.fill;
  style['stroke'] = base.stroke;
  style['dropShadow'] = base.dropShadow;
  label.alpha = base.alpha;
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
      color: #ffd447 !important;
      font-weight: 800 !important;
      text-shadow:
        -1px -1px 0 #000,
         1px -1px 0 #000,
        -1px  1px 0 #000,
         1px  1px 0 #000,
         0 0 4px rgba(255, 190, 35, .9),
         0 0 8px rgba(255, 157, 0, .5) !important;
      animation: vip-chat-name-glow 1.65s ease-in-out infinite;
    }
    @keyframes vip-chat-name-glow {
      0%, 100% {
        color: #f5bf2c;
        text-shadow:
          -1px -1px 0 #000,
           1px -1px 0 #000,
          -1px  1px 0 #000,
           1px  1px 0 #000,
           0 0 3px rgba(255, 174, 0, .72),
           0 0 6px rgba(255, 132, 0, .35);
      }
      50% {
        color: #ffe36a;
        text-shadow:
          -1px -1px 0 #000,
           1px -1px 0 #000,
          -1px  1px 0 #000,
           1px  1px 0 #000,
           0 0 5px rgba(255, 203, 51, .95),
           0 0 9px rgba(255, 157, 0, .55);
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .chat-line.say b.vip-chat-name { animation: none !important; }
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

function animateGlow(time: number): void {
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  // Keep the pulse subtle so the black outline remains visually stable.
  const pulse = reducedMotion ? 1 : 0.95 + ((Math.sin(time / 360) + 1) / 2) * 0.05;
  for (const label of [...glowingLabels]) {
    if (label.destroyed) {
      glowingLabels.delete(label);
      continue;
    }
    label.alpha = pulse;
  }
  window.requestAnimationFrame(animateGlow);
}

installChatStyle();
startChatObserver();
void refreshVipNames();
window.setInterval(() => { void refreshVipNames(); }, VIP_REFRESH_MS);
window.requestAnimationFrame(animateGlow);
