import { useState } from 'react';
import { vocationsById, PLAYABLE_VOCATION_IDS } from '@tibia-idle/data';
import type { WorldView } from '../api/types.js';
import { PartyPortrait } from './PartyPortrait.js';
import { formatNumber } from '../format.js';

export function RankPanel({ world, selfId }: { world: WorldView | null; selfId?: number }) {
  const [tab, setTab] = useState<keyof WorldView['ranks']>('level');
  const [query, setQuery] = useState('');
  const [vocation, setVocation] = useState(0);
  const labels = { level: 'Nível', gold: 'Ouro', bestiary: 'Bestiário', skill: 'Habilidade' };
  const ranked = (world?.ranks[tab] ?? []).map((row, index) => ({ ...row, position: index + 1 }));
  const visible = ranked.filter((row) => row.name.toLowerCase().includes(query.toLowerCase()) && (!vocation || row.vocationId === vocation || row.vocationId === vocation + 4));
  return <div className="rank-panel">
    <div className="rank-intro"><span>HALL DOS AVENTUREIROS</span><h3>Os destaques do mundo</h3><p>Até 100 personagens por categoria. Compare nível, riqueza, conquistas e habilidades.</p></div>
    <div className="tabs">{Object.entries(labels).map(([key, label]) => <button type="button" key={key} className={tab === key ? 'on' : ''} onClick={() => setTab(key as typeof tab)}>{label}</button>)}</div>
    <div className="rank-filters"><input aria-label="Buscar nick" placeholder="Buscar nick do jogador…" value={query} onChange={(event) => setQuery(event.target.value)} /><select aria-label="Filtrar classe" value={vocation} onChange={(event) => setVocation(Number(event.target.value))}><option value={0}>Todas as classes</option>{PLAYABLE_VOCATION_IDS.map((id) => <option key={id} value={id}>{vocationsById.get(id)?.name}</option>)}</select></div>
    {!world ? <p>Carregando ranking…</p> : <div className="rank-table-wrap"><table className="rank-table"><thead><tr><th>Posição</th><th>Jogador</th><th>Classe</th><th>Nível</th><th>{labels[tab]}</th></tr></thead><tbody>{visible.map((row) => <tr className={(row.id === selfId ? 'rank-self ' : '') + (row.position <= 3 ? 'rank-podium' : '')} key={row.id}><td><b>#{row.position}</b></td><td><span className="rank-player"><PartyPortrait appearance={row.appearance} size={32} /><strong>{row.name}{row.id === selfId && <small> você</small>}</strong></span></td><td>{vocationsById.get(row.vocationId ?? 0)?.name ?? '—'}</td><td>{row.level ?? '—'}</td><td><b>{formatNumber(row.value)}</b></td></tr>)}</tbody></table>{!visible.length && <p>Nenhum personagem encontrado.</p>}</div>}
  </div>;
}
