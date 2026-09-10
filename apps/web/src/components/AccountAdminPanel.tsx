import { useEffect, useState } from 'react';
import { items, PLAYABLE_VOCATION_IDS, vocationsById } from '@tibia-idle/data';
import { api } from '../api/client.js';

export function AccountAdminPanel() {
  const [data, setData] = useState<Awaited<ReturnType<typeof api.admin>> | null>(null);
  const [accountId, setAccountId] = useState(0);
  const [characterId, setCharacterId] = useState(0);
  const [gold, setGold] = useState('0');
  const [itemQuery, setItemQuery] = useState('');
  const [itemId, setItemId] = useState(0);
  const [count, setCount] = useState('1');
  const [name, setName] = useState('');
  const [vocationId, setVocationId] = useState(4);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  useEffect(() => { void api.admin().then((result) => { setData(result); setAccountId(result.accounts[0]?.id ?? 0); }).catch((reason: Error) => setError(reason.message)); }, []);
  const account = data?.accounts.find((entry) => entry.id === accountId);
  const character = account?.characters.find((entry) => entry.id === characterId);
  useEffect(() => { setCharacterId(account?.characters[0]?.id ?? 0); }, [accountId]);
  useEffect(() => { setGold(String(character?.gold ?? 0)); }, [characterId, character?.gold]);
  const run = async (body: Record<string, unknown>) => {
    setBusy(true); setError(''); setMessage('');
    try { await api.adminAct(body); setData(await api.admin()); setMessage('Alteração salva no servidor.'); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Falha ao salvar.'); }
    finally { setBusy(false); }
  };
  const results = items.filter((item) => item.name.toLowerCase().includes(itemQuery.toLowerCase()) || String(item.id) === itemQuery).slice(0, 80);
  return <section className="account-admin"><h2>Administração</h2><p>Gerencie contas e personagens. Ouro e itens pertencem aos personagens; o painel da conta mostra a soma dos saldos.</p>
    {error && <p role="alert" className="portal-error">{error}</p>}{message && <p role="status" className="portal-success">{message}</p>}
    {!data ? <p>Carregando contas…</p> : <>
      <label>Conta<select value={accountId} disabled={busy} onChange={(event) => setAccountId(Number(event.target.value))}>{data.accounts.map((entry) => <option key={entry.id} value={entry.id}>{entry.username}{entry.admin ? ' · administrador' : ''}{entry.banned ? ' · banida' : ''}</option>)}</select></label>
      <div className="portal-grid">
        <section className="portal-card"><h3>Acesso da conta</h3><p>{account?.banned ? 'Esta conta está banida.' : 'Esta conta pode acessar o jogo.'}</p><label>Motivo<input value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} /></label>
          <button className="btn danger" disabled={busy || !account || account.admin} onClick={() => { void run({ type: account?.banned ? 'unban' : 'ban', accountId, reason }); }}>{account?.banned ? 'Remover banimento' : 'Banir conta e desconectar'}</button>
        </section>
        <section className="portal-card"><h3>Criar personagem nesta conta</h3><form onSubmit={(event) => { event.preventDefault(); void run({ type: 'create-character', accountId, name: name.trim(), vocationId }); }}><label>Nome<input value={name} onChange={(event) => setName(event.target.value)} required minLength={2} maxLength={24} /></label><label>Classe<select value={vocationId} onChange={(event) => setVocationId(Number(event.target.value))}>{PLAYABLE_VOCATION_IDS.map((id) => <option key={id} value={id}>{vocationsById.get(id)?.name}</option>)}</select></label><button className="btn" disabled={busy || !name.trim()}>Criar personagem</button></form></section>
      </div>
      <label>Personagem para editar<select value={characterId} disabled={busy} onChange={(event) => setCharacterId(Number(event.target.value))}>{account?.characters.map((entry) => <option key={entry.id} value={entry.id}>{entry.name} · nível {entry.level}</option>)}</select></label>
      <div className="portal-grid"><section className="portal-card"><h3>Editar ouro</h3><p>Saldo atual: {(character?.gold ?? 0).toLocaleString('pt-BR')} gold</p><form onSubmit={(event) => { event.preventDefault(); void run({ type: 'set-gold', characterId, gold: Number(gold) }); }}><label>Novo saldo total<input type="number" min={0} max={1_000_000_000} step={1} value={gold} onChange={(event) => setGold(event.target.value)} required /></label><button className="btn" disabled={busy || !character}>Salvar saldo</button></form></section>
        <section className="portal-card"><h3>Editar itens do depósito</h3><p>Defina a quantidade total deste item no depósito. Zero remove o item do depósito.</p><form onSubmit={(event) => { event.preventDefault(); void run({ type: 'set-item', characterId, itemId, count: Number(count) }); }}><label>Buscar item por nome ou ID<input value={itemQuery} onChange={(event) => setItemQuery(event.target.value)} /></label><label>Item<select value={itemId} onChange={(event) => setItemId(Number(event.target.value))} required><option value={0}>Selecione um item</option>{results.map((item) => <option key={item.id} value={item.id}>{item.id} · {item.name}</option>)}</select></label><label>Quantidade<input type="number" value={count} onChange={(event) => setCount(event.target.value)} min={0} max={100000} step={1} required /></label><button className="btn" disabled={busy || !character || !itemId}>Salvar item</button></form></section></div>
    </>}
  </section>;
}
