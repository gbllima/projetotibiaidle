import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import type { AccountView, CharacterView } from '../api/types.js';
import { AccountAdminPanel } from '../components/AccountAdminPanel.js';
import { PartyPortrait } from '../components/PartyPortrait.js';
import { formatStamina } from '../format.js';
import './portal.css';

export function AccountScreen({ onHome, onEnter, onLogout, onSelect }: { onHome: () => void; onEnter: (id: number) => void; onLogout: () => void; onSelect: () => void }) {
  const [account, setAccount] = useState<AccountView | null>(null);
  const [characters, setCharacters] = useState<CharacterView[]>([]);
  const [tab, setTab] = useState<'account' | 'admin'>('account');
  const [error, setError] = useState('');
  const [updated, setUpdated] = useState<Date | null>(null);
  const [loading, setLoading] = useState(false);
  const refresh = async () => {
    setLoading(true); setError('');
    try { const result = await api.characters(); setAccount(result.account); setCharacters(result.characters); setUpdated(new Date()); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível carregar sua conta.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void refresh(); }, []);
  return <main className="portal-page"><header className="portal-nav"><button onClick={onHome}>← Início</button><strong>IDLE KNOCK TIBIA</strong><button onClick={onLogout}>Sair da conta</button></header><div className="portal-content">
    <div className="portal-heading"><span>PAINEL DO JOGADOR</span><h1>{account?.username ?? 'Sua conta'}</h1><p>Consulte seus personagens, recursos e progresso sem abrir o jogo.</p></div>
    {error && <p className="portal-error" role="alert">{error}</p>}
    <nav className="portal-tabs"><button className={tab === 'account' ? 'on' : ''} onClick={() => setTab('account')}>Minha conta</button>{account?.admin && <button className={tab === 'admin' ? 'on' : ''} onClick={() => setTab('admin')}>Administração</button>}<button disabled={loading} onClick={() => { void refresh(); }}>{loading ? 'Atualizando…' : 'Atualizar dados'}</button></nav>
    {tab === 'admin' && account?.admin ? <AccountAdminPanel /> : <>
      <div className="portal-summary"><article><small>Personagens</small><b>{characters.length}/{account?.slots ?? '—'}</b></article><article><small>Ouro total</small><b>{characters.reduce((sum, entry) => sum + entry.gold, 0).toLocaleString('pt-BR')}</b></article><article><small>Coins totais</small><b>{characters.reduce((sum, entry) => sum + entry.coins, 0).toLocaleString('pt-BR')}</b></article><article><small>Em caçada</small><b>{characters.filter((entry) => entry.session?.status === 'active').length}</b></article></div>
      <div className="portal-grid">{characters.map((character) => <article className="portal-card account-character" key={character.id}>
        <header><PartyPortrait appearance={character.appearance} size={48} /><div><h2>{character.name}</h2><p>{character.vocation.name} · nível {character.level}</p></div></header>
        <dl><dt>Situação</dt><dd>{character.session ? 'Em caçada' : character.queue ? 'Na fila da caçada' : 'Cidade · Safe Zone'}</dd><dt>Experiência</dt><dd>{character.experience.toLocaleString('pt-BR')}</dd><dt>Ouro</dt><dd>{character.gold.toLocaleString('pt-BR')}</dd><dt>Coins</dt><dd>{character.coins}</dd><dt>Stamina</dt><dd>{formatStamina(character.stamina)} / 42h</dd><dt>Vida</dt><dd>{Math.round(character.health)}/{character.maxHealth}</dd><dt>Mana</dt><dd>{Math.round(character.mana)}/{character.maxMana}</dd><dt>Party</dt><dd>{character.partyMemberIds?.length ?? 1}/{character.partySlots} membros</dd><dt>Guild</dt><dd>{character.guildId ? '#' + character.guildId : 'Sem guild'}</dd></dl>
        <button className="btn gold" onClick={() => onEnter(character.id)}>Entrar com este personagem</button>
      </article>)}</div>
      {!loading && !characters.length && <p>Você ainda não tem personagens.</p>}
      <button className="btn" onClick={onSelect}>Criar ou selecionar personagem</button>
      <p className="portal-note">{updated && 'Atualizado às ' + updated.toLocaleTimeString('pt-BR') + '. '}A stamina recupera na cidade, mesmo com o painel aberto. Caçadas ativas continuam normalmente.</p>
    </>}
  </div></main>;
}
