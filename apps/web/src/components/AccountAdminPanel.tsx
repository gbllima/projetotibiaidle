import { useEffect, useState } from 'react';
import { items, PLAYABLE_VOCATION_IDS, vocationsById } from '@tibia-idle/data';
import { api } from '../api/client.js';
import './AccountAdminNews.css';

type NewsItem = {
  id: string;
  title: string;
  category: string;
  summary: string;
  body: string;
  published: boolean;
  createdAt: number;
  updatedAt: number;
  publishedAt: number;
};

type AdminData = Awaited<ReturnType<typeof api.admin>> & { news?: NewsItem[] };

export function AccountAdminPanel() {
  const [data, setData] = useState<AdminData | null>(null);
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

  const [newsId, setNewsId] = useState<string | null>(null);
  const [newsTitle, setNewsTitle] = useState('');
  const [newsCategory, setNewsCategory] = useState('Novidade');
  const [newsSummary, setNewsSummary] = useState('');
  const [newsBody, setNewsBody] = useState('');
  const [newsPublished, setNewsPublished] = useState(true);

  useEffect(() => {
    void api.admin()
      .then((result) => {
        const next = result as AdminData;
        setData(next);
        setAccountId(next.accounts[0]?.id ?? 0);
      })
      .catch((reason: Error) => setError(reason.message));
  }, []);

  const account = data?.accounts.find((entry) => entry.id === accountId);
  const character = account?.characters.find((entry) => entry.id === characterId);
  const news = data?.news ?? [];

  useEffect(() => { setCharacterId(account?.characters[0]?.id ?? 0); }, [accountId]);
  useEffect(() => { setGold(String(character?.gold ?? 0)); }, [characterId, character?.gold]);

  const run = async (body: Record<string, unknown>): Promise<boolean> => {
    setBusy(true); setError(''); setMessage('');
    try {
      await api.adminAct(body);
      setData(await api.admin() as AdminData);
      setMessage('Alteração salva no servidor.');
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Falha ao salvar.');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const resetNews = () => {
    setNewsId(null);
    setNewsTitle('');
    setNewsCategory('Novidade');
    setNewsSummary('');
    setNewsBody('');
    setNewsPublished(true);
  };

  const editNews = (item: NewsItem) => {
    setNewsId(item.id);
    setNewsTitle(item.title);
    setNewsCategory(item.category);
    setNewsSummary(item.summary);
    setNewsBody(item.body);
    setNewsPublished(item.published);
    window.setTimeout(() => document.getElementById('admin-news-title')?.focus(), 0);
  };

  const saveNews = async () => {
    const ok = await run({
      type: newsId ? 'news-update' : 'news-create',
      ...(newsId ? { id: newsId } : {}),
      title: newsTitle.trim(),
      category: newsCategory.trim(),
      summary: newsSummary.trim(),
      body: newsBody.trim(),
      published: newsPublished,
    });
    if (ok) resetNews();
  };

  const results = items.filter((item) => item.name.toLowerCase().includes(itemQuery.toLowerCase()) || String(item.id) === itemQuery).slice(0, 80);

  return <section className="account-admin"><h2>Administração</h2><p>Gerencie o site, contas e personagens. Ouro e itens pertencem aos personagens; o painel da conta mostra a soma dos saldos.</p>
    {error && <p role="alert" className="portal-error">{error}</p>}{message && <p role="status" className="portal-success">{message}</p>}
    {!data ? <p>Carregando administração…</p> : <>
      <section className="portal-card admin-news-editor">
        <div className="admin-news-heading">
          <div><small>SITE · KNOCK HUNT BR</small><h3>Notícias da página inicial</h3><p>Crie, edite e publique notícias que aparecem automaticamente na home do servidor.</p></div>
          <span className="admin-news-count">{news.filter((item) => item.published).length} publicadas</span>
        </div>

        <form className="admin-news-form" onSubmit={(event) => { event.preventDefault(); void saveNews(); }}>
          <div className="admin-news-fields">
            <label>Título<input id="admin-news-title" value={newsTitle} onChange={(event) => setNewsTitle(event.target.value)} minLength={3} maxLength={120} required placeholder="Ex.: Nova atualização disponível" /></label>
            <label>Categoria<input value={newsCategory} onChange={(event) => setNewsCategory(event.target.value)} maxLength={40} placeholder="Atualização, Evento, Comunicado..." /></label>
          </div>
          <label>Resumo<input value={newsSummary} onChange={(event) => setNewsSummary(event.target.value)} minLength={5} maxLength={280} required placeholder="Texto curto exibido no card da notícia." /></label>
          <label>Conteúdo<textarea value={newsBody} onChange={(event) => setNewsBody(event.target.value)} minLength={5} maxLength={8000} required placeholder="Escreva aqui a notícia completa. Quebras de linha serão preservadas." /></label>
          <label className="admin-news-publish"><input type="checkbox" checked={newsPublished} onChange={(event) => setNewsPublished(event.target.checked)} /><span><strong>Publicar na página inicial</strong><small>Desmarque para salvar como rascunho.</small></span></label>
          <div className="admin-news-actions">
            <button className="btn gold" type="submit" disabled={busy || !newsTitle.trim() || !newsSummary.trim() || !newsBody.trim()}>{newsId ? 'Salvar alterações' : 'Publicar notícia'}</button>
            {newsId && <button className="btn" type="button" disabled={busy} onClick={resetNews}>Cancelar edição</button>}
          </div>
        </form>

        <div className="admin-news-list">
          {news.length === 0 ? <p className="admin-news-empty">Nenhuma notícia cadastrada ainda.</p> : news.map((item) => <article className="admin-news-item" key={item.id}>
            <div className="admin-news-item-copy">
              <div className="admin-news-meta"><span>{item.category}</span><em className={item.published ? 'is-live' : ''}>{item.published ? 'PUBLICADA' : 'RASCUNHO'}</em><time>{new Date(item.updatedAt || item.createdAt).toLocaleDateString('pt-BR')}</time></div>
              <strong>{item.title}</strong><p>{item.summary}</p>
            </div>
            <div className="admin-news-item-actions"><button className="btn" disabled={busy} onClick={() => editNews(item)}>Editar</button><button className="btn danger" disabled={busy} onClick={() => { if (window.confirm(`Excluir a notícia "${item.title}"?`)) void run({ type: 'news-delete', id: item.id }); }}>Excluir</button></div>
          </article>)}
        </div>
      </section>

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
