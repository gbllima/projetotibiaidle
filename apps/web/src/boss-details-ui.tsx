import { createRoot, type Root } from 'react-dom/client';
import { bossEncounters, monstersById, type BossEncounter } from '@tibia-idle/data';
import { BossDetailsModal } from './components/BossDetailsModal.js';

let activeRoot: Root | null = null;
let activeHost: HTMLDivElement | null = null;

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

export function enhanceBossDetailButtons() {
  document.querySelectorAll<HTMLButtonElement>('.boss-browser .boss-row').forEach((row) => {
    const next = row.nextElementSibling as HTMLElement | null;
    if (row.dataset.bossDetailEnhanced === '1' && next?.classList.contains('boss-detail-button--boss')) return;

    const encounter = encounterForRow(row);
    if (!encounter) return;

    row.dataset.bossDetailEnhanced = '1';
    row.classList.add('boss-row-with-detail');

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn gold hunt-detail-button boss-detail-button--boss';
    button.textContent = 'Detalhe';
    button.setAttribute('aria-label', `Detalhe de ${monstersById.get(encounter.monsterId)?.name ?? encounter.monsterId}`);
    button.dataset.encounterId = encounter.id;
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      openBossDetails(encounter);
    });
    row.insertAdjacentElement('afterend', button);
  });
}
