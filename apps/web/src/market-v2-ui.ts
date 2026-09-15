import { storedToken } from './api/client.js';
import './market-v2.css';

type MarketItem = {
  itemId: number;
  name: string;
  category: string;
  available: number;
  offers: number;
  lowestPrice: number;
};
type MarketOffer = {
  id: number;
  sellerId: number;
  seller: string;
  itemId: number;
  count: number;
  unitPrice: number;
  total: number;
  createdAt: number;
  expiresAt: number;
};
type MyOffer = {
  id: number;
  itemId: number;
  name: string;
  count: number;
  unitPrice: number;
  total: number;
  createdAt: number;
  expiresAt: number;
};
type InventoryItem = {
  itemId: number;
  name: string;
  count: number;
  category: string;
  npcPrice: number;
};
type HistoryEntry = {
  id: string;
  itemId: number;
  itemName: string;
  count: number;
  unitPrice: number;
  total: number;
  buyerId: number;
  buyerName: string;
  sellerId: number;
  sellerName: string;
  at: number;
};
type MarketSnapshot = {
  rules: { feePercent: number; expiresHours: number; maxOffers: number; minLevel: number; currency: 'gold' };
  character: { id: number; name: string; level: number; gold: number };
  items: MarketItem[];
  offers: MarketOffer[];
  myOffers: MyOffer[];
  inventory: InventoryItem[];
  history: HistoryEntry[];
  averages: Array<{ itemId: number; averagePrice: number; lastTradeAt: number }>;
};
type MarketTab = 'buy' | 'sell' | 'mine' | 'history';
type UiState = {
  characterId: number;
  snapshot: MarketSnapshot | null;
  tab: MarketTab;
  query: string;
  category: string;
  selectedItemId: number | null;
  selectedSellId: number | null;
  buyCount: number;
  sellCount: number;
  sellPrice: number;
  busy: boolean;
  message: string;
  error: boolean;
  timer?: number;
};

const states = new WeakMap<HTMLElement, UiState>();
let scanQueued = false;

function esc(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function gold(value: number): string {
  return Math.max(0, Math.floor(value || 0)).toLocaleString('pt-BR') + 'g';
}

function agoTime(timestamp: number): string {
  const ms = Math.max(0, Date.now() - timestamp);
  const min = Math.floor(ms / 60_000);
  if (min < 1) return 'agora';
  if (min < 60) return `${min} min`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function timeLeft(timestamp: number): string {
  const ms = timestamp - Date.now();
  if (ms <= 0) return 'expirando';
  const hours = Math.floor(ms / 3_600_000);
  if (hours >= 24) return `${Math.floor(hours / 24)}d ${hours % 24}h`;
  return `${hours}h`;
}

async function jsonRequest<T>(url: string, method: 'GET' | 'POST' = 'GET', body?: unknown): Promise<T> {
  const token = storedToken();
  const response = await fetch(url, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let payload: Record<string, unknown> = {};
  try { payload = text ? JSON.parse(text) as Record<string, unknown> : {}; } catch { payload = {}; }
  if (!response.ok) throw new Error(String(payload['error'] ?? response.statusText ?? 'Erro no mercado.'));
  return payload as T;
}

async function currentCharacterId(): Promise<number> {
  const currentName = document.querySelector<HTMLElement>('.topnav .who strong')?.textContent?.trim() ?? '';
  const payload = await jsonRequest<{ characters: Array<{ id: number; name: string }> }>('/api/characters');
  const exact = payload.characters.find((entry) => entry.name === currentName);
  if (exact) return exact.id;
  if (payload.characters.length === 1) return payload.characters[0]!.id;
  throw new Error('Não consegui identificar o personagem atual.');
}

function categoryButtons(state: UiState): string {
  const categories = ['Todos', ...new Set((state.snapshot?.items ?? []).map((item) => item.category))];
  return categories.map((category) => `
    <button type="button" class="${state.category === category ? 'on' : ''}" data-market-category="${esc(category)}">${esc(category)}</button>
  `).join('');
}

function averageFor(snapshot: MarketSnapshot, itemId: number): number {
  return snapshot.averages.find((entry) => entry.itemId === itemId)?.averagePrice ?? 0;
}

function offersFor(snapshot: MarketSnapshot, itemId: number): MarketOffer[] {
  return snapshot.offers.filter((offer) => offer.itemId === itemId).sort((a, b) => a.unitPrice - b.unitPrice || a.createdAt - b.createdAt);
}

function estimateCost(snapshot: MarketSnapshot, itemId: number, wanted: number): number {
  let remaining = Math.max(1, wanted);
  let total = 0;
  for (const offer of offersFor(snapshot, itemId)) {
    const take = Math.min(remaining, offer.count);
    total += take * offer.unitPrice;
    remaining -= take;
    if (remaining <= 0) break;
  }
  return remaining > 0 ? 0 : total;
}

function renderBuy(state: UiState, snapshot: MarketSnapshot): string {
  const needle = state.query.trim().toLocaleLowerCase('pt-BR');
  const rows = snapshot.items.filter((item) => {
    if (state.category !== 'Todos' && item.category !== state.category) return false;
    return !needle || item.name.toLocaleLowerCase('pt-BR').includes(needle) || String(item.itemId) === needle;
  });
  if (state.selectedItemId === null && rows.length) state.selectedItemId = rows[0]!.itemId;
  const selected = rows.find((item) => item.itemId === state.selectedItemId)
    ?? snapshot.items.find((item) => item.itemId === state.selectedItemId)
    ?? null;
  const offers = selected ? offersFor(snapshot, selected.itemId) : [];
  const max = selected?.available ?? 1;
  state.buyCount = Math.max(1, Math.min(state.buyCount || 1, Math.max(1, max)));
  const estimated = selected ? estimateCost(snapshot, selected.itemId, state.buyCount) : 0;
  const avg = selected ? averageFor(snapshot, selected.itemId) : 0;

  return `
    <div class="market-v2-toolbar">
      <input class="market-v2-search" data-market-search placeholder="Buscar item pelo nome ou ID..." value="${esc(state.query)}">
      <div class="market-v2-cats">${categoryButtons(state)}</div>
    </div>
    <div class="market-v2-grid">
      <section class="market-v2-panel">
        <div class="market-v2-panel-head"><span>Item</span><span class="market-v2-num">Disp.</span><span class="market-v2-num">Menor preço</span></div>
        <div class="market-v2-list">
          ${rows.length ? rows.map((item) => `
            <button type="button" class="market-v2-row ${selected?.itemId === item.itemId ? 'on' : ''}" data-market-item="${item.itemId}">
              <span><span class="market-v2-name">${esc(item.name)}</span><span class="market-v2-meta">${esc(item.category)} · ${item.offers} oferta${item.offers === 1 ? '' : 's'}</span></span>
              <span class="market-v2-num">${item.available.toLocaleString('pt-BR')}</span>
              <span class="market-v2-num market-v2-price">${gold(item.lowestPrice)}</span>
            </button>
          `).join('') : '<div class="market-v2-empty">Nenhuma oferta encontrada.</div>'}
        </div>
      </section>
      <section class="market-v2-panel">
        ${selected ? `
          <div class="market-v2-detail">
            <h3>${esc(selected.name)}</h3>
            <div class="market-v2-kv">
              <span>Menor preço</span><strong>${gold(selected.lowestPrice)}</strong>
              <span>Disponível</span><strong>${selected.available.toLocaleString('pt-BR')}</strong>
              <span>Preço médio recente</span><strong>${avg ? gold(avg) : 'sem histórico'}</strong>
              <span>Seu saldo</span><strong>${gold(snapshot.character.gold)}</strong>
            </div>
            <div class="market-v2-offers">
              ${offers.slice(0, 6).map((offer) => `
                <div class="market-v2-offer"><span>${esc(offer.seller)}</span><span>${offer.count}x</span><b>${gold(offer.unitPrice)}</b></div>
              `).join('')}
            </div>
            <div class="market-v2-control">
              <label>Quantidade<input type="number" min="1" max="${selected.available}" step="1" data-market-buy-count value="${state.buyCount}"></label>
              <label>Total estimado<input readonly value="${estimated ? gold(estimated) : 'indisponível'}"></label>
            </div>
            <button type="button" class="market-v2-action" data-market-buy="${selected.itemId}" ${state.busy || !estimated || estimated > snapshot.character.gold ? 'disabled' : ''}>COMPRAR ${state.buyCount}x</button>
            <div class="market-v2-footnote">A compra pega automaticamente as ofertas mais baratas. Você nunca compra sua própria oferta.</div>
          </div>
        ` : '<div class="market-v2-empty">Selecione um item para ver as ofertas.</div>'}
      </section>
    </div>
  `;
}

function renderSell(state: UiState, snapshot: MarketSnapshot): string {
  const needle = state.query.trim().toLocaleLowerCase('pt-BR');
  const inventory = snapshot.inventory.filter((item) => !needle || item.name.toLocaleLowerCase('pt-BR').includes(needle) || String(item.itemId) === needle);
  if (state.selectedSellId === null && inventory.length) state.selectedSellId = inventory[0]!.itemId;
  const selected = snapshot.inventory.find((item) => item.itemId === state.selectedSellId) ?? null;
  const market = selected ? snapshot.items.find((item) => item.itemId === selected.itemId) : null;
  if (selected) {
    state.sellCount = Math.max(1, Math.min(state.sellCount || 1, selected.count));
    if (!state.sellPrice) state.sellPrice = market?.lowestPrice ?? Math.max(1, (selected.npcPrice || 1) * 2);
  }
  const total = selected ? state.sellCount * state.sellPrice : 0;
  const net = Math.floor(total * (1 - snapshot.rules.feePercent / 100));

  return `
    <div class="market-v2-toolbar">
      <input class="market-v2-search" data-market-search placeholder="Buscar no seu Depot..." value="${esc(state.query)}">
    </div>
    <div class="market-v2-grid">
      <section class="market-v2-panel market-v2-inventory">
        <div class="market-v2-panel-head"><span>Depot</span><span class="market-v2-num">Qtd.</span><span class="market-v2-num">Mercado</span></div>
        <div class="market-v2-list">
          ${inventory.length ? inventory.map((item) => {
            const current = snapshot.items.find((entry) => entry.itemId === item.itemId);
            return `
              <button type="button" class="market-v2-row ${selected?.itemId === item.itemId ? 'on' : ''}" data-market-sell-item="${item.itemId}">
                <span><span class="market-v2-name">${esc(item.name)}</span><span class="market-v2-meta">${esc(item.category)}</span></span>
                <span class="market-v2-num">${item.count}</span>
                <span class="market-v2-num market-v2-price">${current ? gold(current.lowestPrice) : '—'}</span>
              </button>`;
          }).join('') : '<div class="market-v2-empty">Seu Depot não possui itens para anunciar.</div>'}
        </div>
      </section>
      <section class="market-v2-panel">
        ${selected ? `
          <div class="market-v2-detail">
            <h3>Anunciar ${esc(selected.name)}</h3>
            <div class="market-v2-kv">
              <span>Você possui</span><strong>${selected.count}</strong>
              <span>NPC paga</span><strong>${selected.npcPrice ? gold(selected.npcPrice) : '—'}</strong>
              <span>Menor oferta atual</span><strong>${market ? gold(market.lowestPrice) : 'nenhuma'}</strong>
              <span>Ofertas ativas</span><strong>${snapshot.myOffers.length}/${snapshot.rules.maxOffers}</strong>
            </div>
            <div class="market-v2-control">
              <label>Quantidade<input type="number" min="1" max="${selected.count}" step="1" data-market-sell-count value="${state.sellCount}"></label>
              <label>Preço por unidade<input type="number" min="1" step="1" data-market-sell-price value="${state.sellPrice}"></label>
            </div>
            <div class="market-v2-kv">
              <span>Total anunciado</span><strong>${gold(total)}</strong>
              <span>Você recebe se vender</span><strong>${gold(net)}</strong>
              <span>Taxa</span><strong>${snapshot.rules.feePercent}%</strong>
              <span>Validade</span><strong>${snapshot.rules.expiresHours}h</strong>
            </div>
            <button type="button" class="market-v2-action" data-market-list="${selected.itemId}" ${state.busy || snapshot.myOffers.length >= snapshot.rules.maxOffers || snapshot.character.level < snapshot.rules.minLevel ? 'disabled' : ''}>CRIAR OFERTA</button>
            <div class="market-v2-footnote">O item sai do Depot enquanto estiver anunciado. Se a oferta expirar ou for cancelada, ele retorna automaticamente.</div>
          </div>
        ` : '<div class="market-v2-empty">Selecione um item do Depot.</div>'}
      </section>
    </div>
  `;
}

function renderMine(state: UiState, snapshot: MarketSnapshot): string {
  return `
    <section class="market-v2-panel">
      <div class="market-v2-panel-head"><span>Minha oferta</span><span class="market-v2-num">Qtd.</span><span class="market-v2-num">Preço</span></div>
      <div class="market-v2-list">
        ${snapshot.myOffers.length ? snapshot.myOffers.map((offer) => `
          <div class="market-v2-myoffer">
            <span><span class="market-v2-name">${esc(offer.name)}</span><span class="market-v2-meta">Total ${gold(offer.total)}</span></span>
            <span class="market-v2-num">${offer.count}x</span>
            <span class="market-v2-num market-v2-price">${gold(offer.unitPrice)}</span>
            <span class="market-v2-expiry">${timeLeft(offer.expiresAt)}</span>
            <button type="button" class="market-v2-secondary market-v2-danger" data-market-cancel="${offer.id}" ${state.busy ? 'disabled' : ''}>Cancelar</button>
          </div>
        `).join('') : '<div class="market-v2-empty">Você não possui ofertas ativas.</div>'}
      </div>
    </section>
    <div class="market-v2-footnote">Limite: ${snapshot.rules.maxOffers} ofertas por personagem · validade ${snapshot.rules.expiresHours}h · taxa de ${snapshot.rules.feePercent}% apenas quando a venda é concluída.</div>
  `;
}

function renderHistory(snapshot: MarketSnapshot): string {
  return `
    <section class="market-v2-panel">
      <div class="market-v2-panel-head"><span>Transação</span><span class="market-v2-num">Qtd.</span><span class="market-v2-num">Preço/un.</span></div>
      <div class="market-v2-list">
        ${snapshot.history.length ? snapshot.history.map((entry) => {
          const bought = entry.buyerId === snapshot.character.id;
          return `
            <div class="market-v2-history-row ${bought ? 'buy' : 'sell'}">
              <span><span class="market-v2-name">${bought ? 'Comprou' : 'Vendeu'} ${esc(entry.itemName)}</span><span class="market-v2-meta">${bought ? `de ${esc(entry.sellerName)}` : `para ${esc(entry.buyerName)}`} · ${agoTime(entry.at)}</span></span>
              <span class="market-v2-num">${entry.count}x</span>
              <span class="market-v2-num market-v2-price">${gold(entry.unitPrice)}</span>
            </div>`;
        }).join('') : '<div class="market-v2-empty">Ainda não há compras ou vendas no seu histórico.</div>'}
      </div>
    </section>
  `;
}

function render(host: HTMLElement): void {
  const state = states.get(host);
  if (!state) return;
  const snapshot = state.snapshot;
  if (!snapshot) {
    host.innerHTML = '<div class="market-v2-loading">Carregando Mercado Global...</div>';
    return;
  }

  let content = '';
  if (state.tab === 'buy') content = renderBuy(state, snapshot);
  else if (state.tab === 'sell') content = renderSell(state, snapshot);
  else if (state.tab === 'mine') content = renderMine(state, snapshot);
  else content = renderHistory(snapshot);

  host.innerHTML = `
    <div class="market-v2">
      <div class="market-v2-top">
        <div class="market-v2-balance"><span>Seu saldo</span><strong>${gold(snapshot.character.gold)}</strong></div>
        <div class="market-v2-rule">Mercado Global · Gold · lvl ${snapshot.rules.minLevel}+ · taxa ${snapshot.rules.feePercent}% · ofertas ${snapshot.rules.expiresHours}h</div>
      </div>
      <div class="market-v2-tabs">
        <button type="button" data-market-tab="buy" class="${state.tab === 'buy' ? 'on' : ''}">Comprar</button>
        <button type="button" data-market-tab="sell" class="${state.tab === 'sell' ? 'on' : ''}">Vender</button>
        <button type="button" data-market-tab="mine" class="${state.tab === 'mine' ? 'on' : ''}">Minhas Ofertas (${snapshot.myOffers.length})</button>
        <button type="button" data-market-tab="history" class="${state.tab === 'history' ? 'on' : ''}">Histórico</button>
      </div>
      ${state.message ? `<div class="market-v2-alert ${state.error ? 'error' : ''}">${esc(state.message)}</div>` : ''}
      ${snapshot.character.level < snapshot.rules.minLevel ? `<div class="market-v2-alert error">O Mercado Global é liberado no level ${snapshot.rules.minLevel}. Você pode visualizar preços, mas ainda não pode negociar.</div>` : ''}
      ${content}
    </div>
  `;
  bind(host);
}

async function refresh(host: HTMLElement, quiet = false): Promise<void> {
  const state = states.get(host);
  if (!state || !host.isConnected) return;
  try {
    const snapshot = await jsonRequest<MarketSnapshot>(`/api/market-v2/${state.characterId}`);
    state.snapshot = snapshot;
    if (!quiet) { state.message = ''; state.error = false; }
    render(host);
  } catch (error) {
    state.message = error instanceof Error ? error.message : 'Não foi possível carregar o mercado.';
    state.error = true;
    render(host);
  }
}

async function action(host: HTMLElement, url: string, body: unknown, success: string): Promise<void> {
  const state = states.get(host);
  if (!state || state.busy) return;
  state.busy = true;
  state.message = '';
  render(host);
  try {
    const result = await jsonRequest<{ snapshot?: MarketSnapshot }>(url, 'POST', body);
    if (result.snapshot) state.snapshot = result.snapshot;
    state.message = success;
    state.error = false;
  } catch (error) {
    state.message = error instanceof Error ? error.message : 'Operação não concluída.';
    state.error = true;
  } finally {
    state.busy = false;
    render(host);
  }
}

function bind(host: HTMLElement): void {
  const state = states.get(host);
  if (!state) return;
  host.querySelectorAll<HTMLButtonElement>('[data-market-tab]').forEach((button) => button.addEventListener('click', () => {
    state.tab = button.dataset['marketTab'] as MarketTab;
    state.query = '';
    state.category = 'Todos';
    state.message = '';
    render(host);
  }));
  host.querySelector<HTMLInputElement>('[data-market-search]')?.addEventListener('input', (event) => {
    state.query = (event.currentTarget as HTMLInputElement).value;
    render(host);
    const input = host.querySelector<HTMLInputElement>('[data-market-search]');
    input?.focus();
    input?.setSelectionRange(state.query.length, state.query.length);
  });
  host.querySelectorAll<HTMLButtonElement>('[data-market-category]').forEach((button) => button.addEventListener('click', () => {
    state.category = button.dataset['marketCategory'] ?? 'Todos';
    state.selectedItemId = null;
    render(host);
  }));
  host.querySelectorAll<HTMLButtonElement>('[data-market-item]').forEach((button) => button.addEventListener('click', () => {
    state.selectedItemId = Number(button.dataset['marketItem']);
    state.buyCount = 1;
    render(host);
  }));
  host.querySelector<HTMLInputElement>('[data-market-buy-count]')?.addEventListener('input', (event) => {
    state.buyCount = Math.max(1, Math.floor(Number((event.currentTarget as HTMLInputElement).value) || 1));
    render(host);
  });
  host.querySelector<HTMLButtonElement>('[data-market-buy]')?.addEventListener('click', (event) => {
    const itemId = Number((event.currentTarget as HTMLButtonElement).dataset['marketBuy']);
    void action(host, `/api/market-v2/${state.characterId}/buy`, { itemId, count: state.buyCount }, `Compra concluída: ${state.buyCount}x item.`);
  });
  host.querySelectorAll<HTMLButtonElement>('[data-market-sell-item]').forEach((button) => button.addEventListener('click', () => {
    state.selectedSellId = Number(button.dataset['marketSellItem']);
    state.sellCount = 1;
    state.sellPrice = 0;
    render(host);
  }));
  host.querySelector<HTMLInputElement>('[data-market-sell-count]')?.addEventListener('input', (event) => {
    state.sellCount = Math.max(1, Math.floor(Number((event.currentTarget as HTMLInputElement).value) || 1));
    render(host);
  });
  host.querySelector<HTMLInputElement>('[data-market-sell-price]')?.addEventListener('input', (event) => {
    state.sellPrice = Math.max(1, Math.floor(Number((event.currentTarget as HTMLInputElement).value) || 1));
    render(host);
  });
  host.querySelector<HTMLButtonElement>('[data-market-list]')?.addEventListener('click', (event) => {
    const itemId = Number((event.currentTarget as HTMLButtonElement).dataset['marketList']);
    void action(host, `/api/market-v2/${state.characterId}/list`, { itemId, count: state.sellCount, unitPrice: state.sellPrice }, 'Oferta criada com sucesso.');
  });
  host.querySelectorAll<HTMLButtonElement>('[data-market-cancel]').forEach((button) => button.addEventListener('click', () => {
    const listingId = Number(button.dataset['marketCancel']);
    void action(host, `/api/market-v2/${state.characterId}/cancel`, { listingId }, 'Oferta cancelada. O item voltou para o Depot.');
  }));
}

async function install(card: HTMLElement): Promise<void> {
  const body = card.querySelector<HTMLElement>('.modal-card-body');
  if (!body || body.querySelector('.market-v2-host')) return;
  card.classList.add('market-v2-modal');
  body.classList.add('market-v2-enhanced');
  const host = document.createElement('div');
  host.className = 'market-v2-host';
  body.prepend(host);
  host.innerHTML = '<div class="market-v2-loading">Abrindo Mercado Global...</div>';

  try {
    const characterId = await currentCharacterId();
    if (!host.isConnected) return;
    const state: UiState = {
      characterId,
      snapshot: null,
      tab: 'buy',
      query: '',
      category: 'Todos',
      selectedItemId: null,
      selectedSellId: null,
      buyCount: 1,
      sellCount: 1,
      sellPrice: 0,
      busy: false,
      message: '',
      error: false,
    };
    states.set(host, state);
    await refresh(host);
    state.timer = window.setInterval(() => {
      if (!host.isConnected) {
        if (state.timer) window.clearInterval(state.timer);
        return;
      }
      if (!state.busy) void refresh(host, true);
    }, 8_000);
  } catch (error) {
    host.innerHTML = `<div class="market-v2-alert error">${esc(error instanceof Error ? error.message : 'Não foi possível abrir o mercado.')}</div>`;
  }
}

function scan(): void {
  scanQueued = false;
  document.querySelectorAll<HTMLElement>('.modal-card').forEach((card) => {
    const title = card.querySelector<HTMLElement>('.window-head-title')?.textContent?.trim();
    if (title === 'Mercado') void install(card);
  });
}

function scheduleScan(): void {
  if (scanQueued) return;
  scanQueued = true;
  queueMicrotask(scan);
}

const root = document.getElementById('root');
if (root) {
  new MutationObserver(scheduleScan).observe(root, { childList: true, subtree: true });
  scheduleScan();
}
