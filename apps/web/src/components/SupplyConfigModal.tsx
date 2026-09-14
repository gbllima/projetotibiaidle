import { useEffect, useMemo, useRef, useState } from 'react';
import { itemsById } from '@tibia-idle/data';
import { isSupplyItem } from '@tibia-idle/sim';
import { LootItemIcon, requestPrefs } from './LootConfigModal.js';
import { WindowHead } from './WindowHead.js';
import './SupplyConfigModal.css';

export function SupplyConfigModal({ characterId, onClose }: { characterId: number; onClose: () => void }) {
  const [ids, setIds] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState('');
  const dialog = useRef<HTMLDivElement>(null);
  const apply = (prefs: Awaited<ReturnType<typeof requestPrefs>>) => setIds(Object.entries(prefs.containers).filter(([, target]) => target === 'supply').map(([id]) => Number(id)));
  useEffect(() => {
    let live = true;
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    void requestPrefs(characterId).then((prefs) => { if (live) apply(prefs); }).catch((e: Error) => { if (live) setError(e.message); }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; previous?.focus(); };
  }, [characterId]);
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return [...itemsById.values()].filter((item) => (adding ? isSupplyItem(item) && !ids.includes(item.id) : ids.includes(item.id)) && (!q || item.name.toLowerCase().includes(q) || String(item.id).includes(q))).sort((a, b) => a.name.localeCompare(b.name)).slice(0, adding ? 60 : 300);
  }, [adding, ids, query]);
  async function change(itemId: number, keep: boolean) {
    if (saving) return;
    setSaving(true); setError('');
    try { apply(await requestPrefs(characterId, { itemId, container: keep ? 'supply' : 'pouch', ...(keep ? { ignored: false } : {}) })); }
    catch (e) { setError((e as Error).message); }
    finally { setSaving(false); }
  }
  return <div className="modal supply-config-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget && !saving) onClose(); }}>
    <div className="supply-config-window" ref={dialog} role="dialog" aria-modal="true" aria-label="Configurar Supply Pouch" tabIndex={-1} onKeyDown={(e) => {
      if (e.key === 'Escape' && !saving) { e.stopPropagation(); onClose(); }
      if (e.key === 'Tab') {
        const nodes = [...e.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)')];
        const first = nodes[0], last = nodes[nodes.length - 1];
        if (e.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
      }
    }}>
      <WindowHead title="Configurar Supply Pouch" onClose={saving ? undefined : onClose} />
      <div className="supply-config-body">
        <p>Escolha poções de vida, poções de mana e flechas. Os drops selecionados vão para a Supply Pouch quando houver espaço e ficam disponíveis para o consumo na caçada.</p>
        <strong className="supply-config-count">SUPRIMENTOS ({ids.length}/300)</strong>
        <button className="btn supply-config-add" disabled={loading || saving} onClick={() => { setAdding(!adding); setQuery(''); }}>{adding ? '← Voltar à lista' : '+ Adicionar item'}</button>
        <input autoComplete="off" aria-label={adding ? 'Buscar suprimento por nome ou ID' : 'Buscar na lista de suprimentos'} placeholder={adding ? 'Buscar por nome ou ID...' : 'Buscar na lista...'} value={query} onChange={(e) => setQuery(e.target.value)} />
        {error && <p role="alert" className="error">{error}</p>}
        <div className="supply-config-list" aria-busy={loading || saving}>
          {loading ? <p>Carregando suprimentos...</p> : matches.length === 0 ? <p>{query ? 'Nenhum item encontrado.' : 'Nenhum suprimento selecionado. Adicione um item.'}</p> : matches.map((item) => <div className="supply-config-item" key={item.id}>
            <LootItemIcon itemId={item.id} /><span>{item.name}</span>
            <button className="btn" disabled={saving || (adding && ids.length >= 300)} aria-label={`${adding ? 'Adicionar' : 'Remover'} ${item.name}`} onClick={() => void change(item.id, adding)}>{adding ? '+' : '×'}</button>
          </div>)}
        </div>
        <small>Salvo automaticamente. Remover da lista altera o destino dos próximos drops; não descarta os itens guardados.</small>
      </div>
      <footer><button className="btn" disabled={saving} onClick={onClose}>Fechar</button></footer>
    </div>
  </div>;
}
