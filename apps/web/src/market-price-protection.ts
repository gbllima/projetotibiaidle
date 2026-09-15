import { storedToken } from './api/client.js';
import './market-price-protection.css';

type PriceRule = {
  itemId: number;
  itemName: string;
  npcPrice: number;
  medianRecentPrice: number;
  recentTrades: number;
  minAllowedPrice: number;
  warningBelowPrice: number;
};

type CachedRule = { rule: PriceRule; expiresAt: number };

const RULE_CACHE_MS = 15_000;
const cache = new Map<number, CachedRule>();
const pending = new Map<number, Promise<PriceRule | null>>();
let scanQueued = false;

function gold(value: number): string {
  return Math.max(0, Math.floor(value || 0)).toLocaleString('pt-BR') + 'g';
}

function cachedRule(itemId: number): PriceRule | null {
  const entry = cache.get(itemId);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(itemId);
    return null;
  }
  return entry.rule;
}

async function fetchRule(itemId: number): Promise<PriceRule | null> {
  const cached = cachedRule(itemId);
  if (cached) return cached;
  const existing = pending.get(itemId);
  if (existing) return existing;

  const task = (async () => {
    try {
      const token = storedToken();
      const response = await fetch(`/api/market-price-protection/${itemId}`, {
        headers: token ? { authorization: `Bearer ${token}` } : {},
      });
      if (!response.ok) return null;
      const rule = await response.json() as PriceRule;
      cache.set(itemId, { rule, expiresAt: Date.now() + RULE_CACHE_MS });
      return rule;
    } catch {
      return null;
    } finally {
      pending.delete(itemId);
    }
  })();

  pending.set(itemId, task);
  return task;
}

function renderRule(detail: HTMLElement, input: HTMLInputElement, button: HTMLButtonElement, rule: PriceRule): void {
  input.min = String(rule.minAllowedPrice);
  input.dataset['marketMinAllowed'] = String(rule.minAllowedPrice);
  input.dataset['marketWarningBelow'] = String(rule.warningBelowPrice);
  input.dataset['marketMedianPrice'] = String(rule.medianRecentPrice);

  detail.querySelector('.market-price-protection-box')?.remove();
  const price = Math.max(0, Math.floor(Number(input.value) || 0));
  const tooLow = price < rule.minAllowedPrice;
  const suspicious = !tooLow && rule.warningBelowPrice > 0 && price < rule.warningBelowPrice;

  const box = document.createElement('div');
  box.className = `market-price-protection-box${tooLow ? ' error' : suspicious ? ' warn' : ''}`;
  const historyText = rule.medianRecentPrice > 0
    ? `Mediana recente: <strong>${gold(rule.medianRecentPrice)}</strong> (${rule.recentTrades} negócio${rule.recentTrades === 1 ? '' : 's'}).`
    : 'Ainda não há histórico recente suficiente para referência de mercado.';
  box.innerHTML = `
    <div><span>Preço mínimo permitido</span><strong>${gold(rule.minAllowedPrice)}</strong></div>
    <small>${historyText}</small>
    ${tooLow ? '<b>Este preço é baixo demais e não pode ser anunciado.</b>' : ''}
    ${suspicious ? '<b>Preço muito abaixo do mercado. Será pedida uma confirmação antes de anunciar.</b>' : ''}
  `;

  button.insertAdjacentElement('beforebegin', box);
  if (tooLow) {
    button.disabled = true;
    button.dataset['marketPriceInvalid'] = 'true';
  } else {
    delete button.dataset['marketPriceInvalid'];
  }
}

async function enhanceButton(button: HTMLButtonElement): Promise<void> {
  const itemId = Number(button.dataset['marketList']);
  if (!Number.isInteger(itemId) || itemId <= 0) return;
  const detail = button.closest<HTMLElement>('.market-v2-detail');
  const input = detail?.querySelector<HTMLInputElement>('[data-market-sell-price]');
  if (!detail || !input) return;

  const rule = await fetchRule(itemId);
  if (!rule || !button.isConnected || !input.isConnected) return;
  const key = `${itemId}:${input.value}:${rule.minAllowedPrice}:${rule.warningBelowPrice}:${rule.medianRecentPrice}`;
  if (button.dataset['marketPriceRuleApplied'] === key) return;
  button.dataset['marketPriceRuleApplied'] = key;
  renderRule(detail, input, button, rule);
}

function scan(): void {
  scanQueued = false;
  document.querySelectorAll<HTMLButtonElement>('[data-market-list]').forEach((button) => {
    void enhanceButton(button);
  });
}

function scheduleScan(): void {
  if (scanQueued) return;
  scanQueued = true;
  queueMicrotask(scan);
}

document.addEventListener('click', (event) => {
  const target = event.target as HTMLElement | null;
  const button = target?.closest<HTMLButtonElement>('[data-market-list]');
  if (!button) return;
  const detail = button.closest<HTMLElement>('.market-v2-detail');
  const input = detail?.querySelector<HTMLInputElement>('[data-market-sell-price]');
  if (!input) return;

  const itemId = Number(button.dataset['marketList']);
  const rule = cachedRule(itemId);
  if (!rule) return;
  const price = Math.max(0, Math.floor(Number(input.value) || 0));

  if (price < rule.minAllowedPrice) {
    event.preventDefault();
    event.stopImmediatePropagation();
    window.alert(`Preço muito baixo. O mínimo permitido para ${rule.itemName} é ${gold(rule.minAllowedPrice)} por unidade.`);
    return;
  }

  if (rule.warningBelowPrice > 0 && price < rule.warningBelowPrice) {
    const ok = window.confirm(
      `${rule.itemName} costuma valer cerca de ${gold(rule.medianRecentPrice)}.\n\n` +
      `Você está anunciando por ${gold(price)} por unidade, bem abaixo da referência.\n\nDeseja continuar mesmo assim?`,
    );
    if (!ok) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }
}, true);

const root = document.getElementById('root');
if (root) {
  new MutationObserver(scheduleScan).observe(root, { childList: true, subtree: true });
  scheduleScan();
}
