import { useEffect, useMemo, useState } from 'react';
import { itemsById } from '@tibia-idle/data';
import { isConsumableItem } from '@tibia-idle/sim';
import type { CharacterView } from '../api/types.js';
import { storedToken } from '../api/client.js';
import { formatNumber, itemValue } from '../format.js';
import { WindowHead } from './WindowHead.js';
import './LootConfigModal.css';

type Tab = 'geral' | 'gerenciar' | 'containers' | 'historico';
type ContainerTarget = 'pouch' | 'backpack' | 'supply' | 'warehouse';
type HistoryEntry = { at: number; kind: 'auto-sell' | 'route'; itemId: number; count: number; gold?: number; target?: ContainerTarget };
type LootPrefs = {
  ignoredItemIds: number[];
  protectedItemIds: number[];
  autoSell: boolean;
  autoSellPercent: number;
  sort: boolean;
  containers: Record<string, ContainerTarget>;
  history: HistoryEntry[];
};

type Props = {
  character: CharacterView;
  lootItems: Array<{ itemId: number; name: string; count: number }>;
  onClose: () => void;
  onChanged?: (prefs: LootPrefs, character?: CharacterView) => void;
};

const DEFAULT_PREFS: LootPrefs = {
  ignoredItemIds: [],
  protectedItemIds: [],
  autoSell: false,
  autoSellPercent: 90,
  sort: false,
  containers: {},
  history: [],
};

async function requestPrefs(id: number, body?: Record<string, unknown>): Promise<LootPrefs & { character?: CharacterView }> {
  const token = storedToken();
  const response = await fetch(`/api/characters/${id}/loot-preferences`, {
    method: body ? 'POST' : 'GET',
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new Error(String(payload.error ?? 'Não foi possível atualizar o Loot Config.'));
  return payload as unknown as LootPrefs & { character?: CharacterView };
}

function itemName(itemId: number): string {
  return itemsById.get(itemId)?.name ?? `#${itemId}`;
}

function findItem(query: string) {
  const raw = query.trim();
  if (!raw) return null;
  const asId = Number(raw);
  if (Number.isInteger(asId) && itemsById.has(asId)) return itemsById.get(asId) ?? null;
  const lowered = raw.toLowerCase();
  return Array.from(itemsById.values()).find((item) => item.name.toLowerCase() === lowered)
    ?? Array.from(itemsById.values()).find((item) => item.name.toLowerCase().includes(lowered))
    ?? null;
}

export function LootConfigModal({ character, lootItems, onClose, onChanged }: Props) {
  const [tab, setTab] = useState<Tab>('geral');
  const [prefs, setPrefs] = useState<LootPrefs>(DEFAULT_PREFS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [ignoreInput, setIgnoreInput] = useState('');
  const [protectInput, setProtectInput] = useState('');
  const [containerInput, setContainerInput] = useState('');
  const [containerTarget, setContainerTarget] = useState<ContainerTarget>('backpack');
  const [listFilter, setListFilter] = useState('');

  const allItems = useMemo(() => Array.from(itemsById.values())
    .filter((item) => item.id > 0)
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')), []);

  useEffect(() => {
    let cancelled = false;
    void requestPrefs(character.id)
      .then((result) => { if (!cancelled) setPrefs({ ...DEFAULT_PREFS, ...result }); })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : 'Erro ao carregar Loot Config.'); });
    return () => { cancelled = true; };
  }, [character.id]);

  const save = async (patch: Record<string, unknown>) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const result = await requestPrefs(character.id, patch);
      const next = { ...DEFAULT_PREFS, ...result };
      setPrefs(next);
      onChanged?.(next, result.character);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível salvar a configuração.');
    } finally {
      setBusy(false);
    }
  };

  const filteredIgnored = prefs.ignoredItemIds.filter((id) => itemName(id).toLowerCase().includes(listFilter.toLowerCase()));
  const filteredProtected = prefs.protectedItemIds.filter((id) => itemName(id).toLowerCase().includes(listFilter.toLowerCase()));
  const containerEntries = useMemo(() => Object.entries(prefs.containers)
    .map(([id, target]) => ({ itemId: Number(id), target }))
    .filter((entry) => entry.itemId > 0 && itemName(entry.itemId).toLowerCase().includes(listFilter.toLowerCase())), [prefs.containers, listFilter]);

  const addIgnored = () => {
    const itemId = Number(ignoreInput);
    if (!Number.isInteger(itemId) || !itemsById.has(itemId)) return setError('Selecione um item da lista.');
    if (prefs.ignoredItemIds.includes(itemId)) return setError('Este item já está na lista Não coletar.');
    void save({ itemId, ignored: true }).then(() => setIgnoreInput(''));
  };
  const addProtected = () => {
    const itemId = Number(protectInput);
    if (!Number.isInteger(itemId) || !itemsById.has(itemId)) return setError('Selecione um item da lista.');
    if (prefs.protectedItemIds.includes(itemId)) return setError('Este item já está na lista Não vender.');
    void save({ itemId, protected: true }).then(() => setProtectInput(''));
  };
  const addContainer = () => {
    const item = findItem(containerInput);
    if (!item) return setError('Item não encontrado. Digite o nome ou ID correto.');
    if (containerTarget === 'supply' && !isConsumableItem(item)) return setError('Este item não pode ser enviado para a Supply Pouch.');
    void save({ itemId: item.id, container: containerTarget }).then(() => setContainerInput(''));
  };

  return <div className="modal loot-config-overlay" onClick={onClose}>
    <div className="modal-card loot-config-window" onClick={(event) => event.stopPropagation()}>
      <WindowHead title="LOOT CONFIG" onClose={onClose} closeLabel="Fechar" />

      <nav className="loot-config-tabs" aria-label="Configuração de loot">
        <button className={tab === 'geral' ? 'active' : ''} onClick={() => setTab('geral')}>Geral</button>
        <button className={tab === 'gerenciar' ? 'active' : ''} onClick={() => setTab('gerenciar')}>Gerenciar loot</button>
        <button className={tab === 'containers' ? 'active' : ''} onClick={() => setTab('containers')}>Containers</button>
        <button className={tab === 'historico' ? 'active' : ''} onClick={() => setTab('historico')}>Histórico</button>
      </nav>

      {error && <div className="party-inline-error loot-config-error" role="alert">{error}</div>}

      <div className="loot-config-content">
        {tab === 'geral' && <section>
          <h3>GERAL</h3>
          <div className="loot-config-row">
            <span>Auto-venda</span>
            <div className="loot-config-toggle">
              <button className={!prefs.autoSell ? 'active' : ''} disabled={busy} onClick={() => void save({ autoSell: false })}>Desligado</button>
              <button className={prefs.autoSell ? 'active' : ''} disabled={busy} onClick={() => void save({ autoSell: true })}>Ligado</button>
            </div>
          </div>
          <p className="loot-config-help">Quando ligada, a auto-venda vende automaticamente os drops vendáveis que não estiverem na lista “Não vender”.</p>
          <div className="loot-config-row">
            <span>Ordenar Loot Pouch</span>
            <div className="loot-config-toggle">
              <button className={!prefs.sort ? 'active' : ''} disabled={busy} onClick={() => void save({ sort: false })}>Desligado</button>
              <button className={prefs.sort ? 'active' : ''} disabled={busy} onClick={() => void save({ sort: true })}>Ligado</button>
            </div>
          </div>
          <div className="loot-config-slider-row">
            <label htmlFor="loot-sell-percent">Vender em</label>
            <input id="loot-sell-percent" type="range" min="10" max="100" step="5" value={prefs.autoSellPercent}
              disabled={busy} onChange={(event) => setPrefs((old) => ({ ...old, autoSellPercent: Number(event.target.value) }))}
              onMouseUp={(event) => void save({ autoSellPercent: Number((event.target as HTMLInputElement).value) })}
              onTouchEnd={(event) => void save({ autoSellPercent: Number((event.target as HTMLInputElement).value) })} />
            <strong>{prefs.autoSellPercent}%</strong>
          </div>
          <p className="loot-config-help">O percentual define quanto do valor de venda do item é convertido em gold pela auto-venda.</p>
        </section>}

        {tab === 'gerenciar' && <section>
          <h3>GERENCIAR LOOT</h3>
          <p className="loot-config-help">Selecione os itens diretamente nas listas. “Não coletar” descarta o drop antes de ocupar slot. “Não vender” protege o item da auto-venda.</p>
          <input className="loot-config-search" placeholder="Buscar nas listas adicionadas..." value={listFilter} onChange={(event) => setListFilter(event.target.value)} />
          <div className="loot-manage-columns">
            <div className="loot-manage-card">
              <h4>NÃO COLETAR ({prefs.ignoredItemIds.length})</h4>
              <div className="loot-add-line">
                <select value={ignoreInput} onChange={(event) => setIgnoreInput(event.target.value)}>
                  <option value="">Selecione um item...</option>
                  {allItems.filter((item) => !prefs.ignoredItemIds.includes(item.id)).map((item) => <option key={`ignore-option-${item.id}`} value={item.id}>{item.name} (ID {item.id})</option>)}
                </select>
                <button disabled={busy || !ignoreInput} onClick={addIgnored}>+ Adicionar</button>
              </div>
              <div className="loot-rule-list">
                {filteredIgnored.length === 0 && <span className="loot-empty">Nenhum item.</span>}
                {filteredIgnored.map((itemId) => <div className="loot-rule-item" key={`ignore-${itemId}`}><span>{itemName(itemId)}</span><button disabled={busy} onClick={() => void save({ itemId, ignored: false })}>×</button></div>)}
              </div>
            </div>
            <div className="loot-manage-card">
              <h4>NÃO VENDER ({prefs.protectedItemIds.length})</h4>
              <div className="loot-add-line">
                <select value={protectInput} onChange={(event) => setProtectInput(event.target.value)}>
                  <option value="">Selecione um item...</option>
                  {allItems.filter((item) => !prefs.protectedItemIds.includes(item.id)).map((item) => <option key={`protect-option-${item.id}`} value={item.id}>{item.name} (ID {item.id})</option>)}
                </select>
                <button disabled={busy || !protectInput} onClick={addProtected}>+ Adicionar</button>
              </div>
              <div className="loot-rule-list">
                {filteredProtected.length === 0 && <span className="loot-empty">Nenhum item.</span>}
                {filteredProtected.map((itemId) => <div className="loot-rule-item" key={`protect-${itemId}`}><span>{itemName(itemId)}</span><button disabled={busy} onClick={() => void save({ itemId, protected: false })}>×</button></div>)}
              </div>
            </div>
          </div>
        </section>}

        {tab === 'containers' && <section>
          <h3>CONTAINERS</h3>
          <p className="loot-config-help">Escolha para onde cada item vai quando for coletado. Sem regra, o item permanece no Loot Pouch.</p>
          <div className="loot-container-add">
            <input value={containerInput} onChange={(event) => setContainerInput(event.target.value)} placeholder="nome ou id do item" />
            <select value={containerTarget} onChange={(event) => setContainerTarget(event.target.value as ContainerTarget)}>
              <option value="backpack">Backpack</option><option value="supply">Supply Pouch</option><option value="warehouse">Armazém</option><option value="pouch">Loot Pouch</option>
            </select>
            <button disabled={busy} onClick={addContainer}>Adicionar</button>
          </div>
          <input className="loot-config-search" placeholder="Buscar na lista..." value={listFilter} onChange={(event) => setListFilter(event.target.value)} />
          <div className="loot-container-list">
            {containerEntries.length === 0 && <span className="loot-empty">Nenhuma regra de container.</span>}
            {containerEntries.map(({ itemId, target }) => <div className="loot-container-item" key={`container-${itemId}`}>
              <span>{itemName(itemId)}</span>
              <select value={target} disabled={busy} onChange={(event) => void save({ itemId, container: event.target.value })}>
                <option value="pouch">Loot Pouch</option><option value="backpack">Backpack</option><option value="supply">Supply Pouch</option><option value="warehouse">Armazém</option>
              </select>
              <button disabled={busy} onClick={() => void save({ itemId, container: 'pouch' })}>×</button>
            </div>)}
          </div>
        </section>}

        {tab === 'historico' && <section>
          <h3>HISTÓRICO</h3>
          <p className="loot-config-help">Movimentações automáticas e vendas recentes. O histórico mantém os últimos 100 eventos.</p>
          <div className="loot-history-current">
            <strong>Loot atual da hunt</strong>
            {lootItems.length === 0 ? <span>Nenhum item no pouch.</span> : lootItems.map((item) => <span key={`current-${item.itemId}`}>{item.name} ×{item.count} · {formatNumber(itemValue(item.itemId) * item.count)}g</span>)}
          </div>
          <div className="loot-history-list">
            {[...prefs.history].reverse().map((entry, index) => <div className="loot-history-item" key={`${entry.at}-${entry.itemId}-${index}`}>
              <span>{new Date(entry.at).toLocaleString('pt-BR')}</span>
              <strong>{itemName(entry.itemId)} ×{entry.count}</strong>
              <span>{entry.kind === 'auto-sell' ? `Auto-venda: +${formatNumber(entry.gold ?? 0)}g` : `Movido para ${entry.target === 'warehouse' ? 'Armazém' : entry.target === 'supply' ? 'Supply Pouch' : entry.target === 'backpack' ? 'Backpack' : 'Loot Pouch'}`}</span>
            </div>)}
            {prefs.history.length === 0 && <span className="loot-empty">Ainda não há movimentações registradas.</span>}
          </div>
        </section>}
      </div>

      <div className="loot-config-footer"><button className="btn" onClick={onClose}>Fechar</button></div>
    </div>
  </div>;
}
