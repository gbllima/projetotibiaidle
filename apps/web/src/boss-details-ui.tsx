import { createRoot, type Root } from 'react-dom/client';
import { bossEncounters, monstersById, type BossEncounter } from '@tibia-idle/data';
import { BossDetailsModal } from './components/BossDetailsModal.js';

let activeRoot: Root | null = null;
let activeHost: HTMLDivElement | null = null;
let buttonLayer: HTMLDivElement | null = null;
let refreshQueued = false;
let listenersBound = false;

function closeBossDetails() {
  activeRoot?.unmount();
  activeRoot = null;
  activeHost?.remove();
  activeHost = null;
}

function openBossDetails(encounter: BossEncounter) {
  closeBossDetails();
  const host = document.createElement('div');
  host.className = 'boss-details-react-host';
  document.body.appendChild(host);
  activeHost = host;
  activeRoot = createRoot(host);
  activeRoot.render(<BossDetailsModal encounter={encounter} onClose={closeBossDetails} />);
}

function visibleBossName(row: HTMLElement): string {
  const title = row.querySelector<HTMLElement>('.hunt-row-title');
  if (!title) return '';
  const textNode = Array.from(title.childNodes).find((node) => node.nodeType === Node.TEXT_NODE);
  return (textNode?.textContent ?? title.textContent ?? '').trim();
}

function bossLocation(row: HTMLElement): string {
  const meta = row.querySelector<HTMLElement>('.hunt-row-meta');
  return (meta?.textContent ?? '').split('·')[0]?.trim() ?? '';
}

function encounterForRow(row: HTMLElement): BossEncounter | null {
  const name = visibleBossName(row);
  if (!name) return null;
  const location = bossLocation(row);
  const matchingName = bossEncounters.filter((entry) => monstersById.get(entry.monsterId)?.name === name);
  return matchingName.find((entry) => entry.location === location) ?? matchingName[0] ?? null;
}

function ensureButtonLayer(): HTMLDivElement {
  if (buttonLayer?.isConnected) return buttonLayer;
  const layer = document.createElement('div');
  layer.className = 'boss-detail-overlay-layer';
  document.body.appendChild(layer);
  buttonLayer = layer;
  return layer;
}

function syncBossDetailButtons() {
  const layer = ensureButtonLayer();
  layer.replaceChildren();

  const rows = Array.from(document.querySelectorAll<HTMLButtonElement>('.boss-browser .boss-row'));
  if (rows.length === 0) return;

  for (const row of rows) {
    const encounter = encounterForRow(row);
    if (!encounter) continue;

    const rect = row.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;

    const modalBody = row.closest<HTMLElement>('.hunt-modal-body');
    const clip = modalBody?.getBoundingClientRect();
    if (clip && (rect.bottom <= clip.top || rect.top >= clip.bottom)) continue;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn gold boss-detail-floating-button';
    button.textContent = 'Detalhe';
    button.setAttribute('aria-label', `Detalhe de ${monstersById.get(encounter.monsterId)?.name ?? encounter.monsterId}`);

    const width = 68;
    const height = 25;
    const left = Math.max(rect.left + 6, rect.right - width - 12);
    let top = rect.bottom - height - 12;
    if (clip) {
      top = Math.max(clip.top + 4, Math.min(top, clip.bottom - height - 4));
    }

    button.style.left = `${Math.round(left)}px`;
    button.style.top = `${Math.round(top)}px`;
    button.style.width = `${width}px`;
    button.style.height = `${height}px`;

    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      openBossDetails(encounter);
    });

    layer.appendChild(button);
  }
}

function scheduleBossDetailButtons() {
  if (refreshQueued) return;
  refreshQueued = true;
  window.requestAnimationFrame(() => {
    refreshQueued = false;
    syncBossDetailButtons();
  });
}

function bindViewportListeners() {
  if (listenersBound) return;
  listenersBound = true;
  window.addEventListener('resize', scheduleBossDetailButtons);
  window.addEventListener('scroll', scheduleBossDetailButtons, true);
}

export function enhanceBossDetailButtons() {
  bindViewportListeners();
  scheduleBossDetailButtons();
}
