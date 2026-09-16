import { useEffect, useMemo, useState } from 'react';
import { storedToken } from '../api/client.js';
import './AccountAdminLogs.css';

type LogKind = 'chat' | 'market' | 'security' | 'economy' | 'admin';

type LogItem = {
  id: string;
  kind: LogKind;
  action?: string;
  channel?: string;
  accountId?: number;
  username?: string;
  characterId?: number;
  actor?: string;
  summary: string;
  details?: Record<string, unknown>;
  suspicious?: boolean;
  reason?: string;
  createdAt: number;
};

type LogsResponse = {
  generatedAt: number;
  limit: number;
  chat: LogItem[];
  market: LogItem[];
  audit: LogItem[];
  suspicious: LogItem[];
  counts: { chat: number; market: number; audit: number; suspicious: number };
};

const KIND_LABELS: Record<LogKind, string> = {
  chat: 'Chat',
  market: 'Mercado',
  security: 'Segurança',
  economy: 'Economia',
  admin: 'Admin',
};

function formatDate(value: number) {
  if (!value) return '—';
  return new Date(value).toLocaleString('pt-BR');
}

function detailsText(details?: Record<string, unknown>) {
  if (!details) return '';
  return Object.entries(details)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .slice(0, 6)
    .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(', ') : String(value)}`)
    .join(' · ');
}

export function AccountAdminLogs() {
  const [data, setData] = useState<LogsResponse | null>(null);
  const [tab, setTab] = useState<'log' | 'suspect'>('log');
  const [filter, setFilter] = useState<'all' | LogKind>('all');
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(300);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const refresh = async (nextLimit = limit) => {
    const token = storedToken();
    if (!token) {
      setError('Faça login novamente.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const response = await fetch(`/api/admin/logs?limit=${nextLimit}`, {
        headers: { authorization: `Bearer ${token}` },
      });
      const payload = await response.json() as LogsResponse & { error?: string };
      if (!response.ok) throw new Error(payload.error || 'Não foi possível carregar os logs.');
      setData(payload);
      setLimit(nextLimit);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível carregar os logs.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void refresh(300); }, []);

  const items = useMemo(() => {
    if (!data) return [];
    const source = tab === 'suspect'
      ? data.suspicious
      : [
          ...data.chat,
          ...data.market,
          ...data.audit.filter((entry) => entry.kind !== 'market'),
        ].sort((a, b) => b.createdAt - a.createdAt);
    const needle = query.trim().toLocaleLowerCase('pt-BR');
    return source.filter((entry) => {
      if (filter !== 'all' && entry.kind !== filter) return false;
      if (!needle) return true;
      return `${entry.actor ?? ''} ${entry.username ?? ''} ${entry.summary} ${entry.reason ?? ''} ${entry.channel ?? ''}`
        .toLocaleLowerCase('pt-BR')
        .includes(needle);
    });
  }, [data, tab, filter, query]);

  return <section className="portal-card admin-log-panel">
    <header className="admin-log-heading">
      <div>
        <small>MODERAÇÃO · AUDITORIA</small>
        <h2>LOG do servidor</h2>
        <p>Histórico de chat, mercado e eventos de segurança. “Suspeito” indica algo para revisão manual; não aplica punição automática.</p>
      </div>
      <button className="btn" disabled={loading} onClick={() => { void refresh(); }}>{loading ? 'Atualizando…' : 'Atualizar'}</button>
    </header>

    {error && <p className="portal-error" role="alert">{error}</p>}

    <div className="admin-log-tabs" role="tablist" aria-label="Tipo de log">
      <button className={tab === 'log' ? 'on' : ''} onClick={() => setTab('log')}>LOG</button>
      <button className={tab === 'suspect' ? 'on suspect' : 'suspect'} onClick={() => setTab('suspect')}>Suspeito <b>{data?.counts.suspicious ?? 0}</b></button>
    </div>

    <div className="admin-log-toolbar">
      <label>Buscar<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Jogador, mensagem, motivo…" /></label>
      <label>Categoria<select value={filter} onChange={(event) => setFilter(event.target.value as 'all' | LogKind)}>
        <option value="all">Todas</option>
        <option value="chat">Chat</option>
        <option value="market">Mercado</option>
        <option value="security">Segurança</option>
        <option value="economy">Economia</option>
        <option value="admin">Admin</option>
      </select></label>
      <label>Quantidade<select value={limit} disabled={loading} onChange={(event) => { void refresh(Number(event.target.value)); }}>
        <option value={300}>300</option>
        <option value={1000}>1.000</option>
        <option value={2500}>2.500</option>
        <option value={5000}>5.000</option>
      </select></label>
    </div>

    <div className="admin-log-stats">
      <span><b>{data?.counts.chat ?? 0}</b> mensagens carregadas</span>
      <span><b>{data?.counts.market ?? 0}</b> eventos de mercado</span>
      <span className="warning"><b>{data?.counts.suspicious ?? 0}</b> suspeitos registrados</span>
    </div>

    <div className="admin-log-list" aria-live="polite">
      {!data && loading ? <p>Carregando logs…</p> : items.length === 0 ? <p>Nenhum registro encontrado para este filtro.</p> : items.map((entry) => <article className={'admin-log-entry' + (entry.suspicious ? ' is-suspicious' : '')} key={`${entry.kind}-${entry.id}`}>
        <div className="admin-log-entry-top">
          <span className={`admin-log-kind kind-${entry.kind}`}>{KIND_LABELS[entry.kind] ?? entry.kind}</span>
          {entry.channel && <span className="admin-log-channel">#{entry.channel}</span>}
          {entry.suspicious && <span className="admin-log-suspect-badge">SUSPEITO</span>}
          <time>{formatDate(entry.createdAt)}</time>
        </div>
        <div className="admin-log-entry-body">
          <strong>{entry.actor || entry.username || 'Sistema'}</strong>
          {entry.username && entry.actor && <small>conta: {entry.username}</small>}
          <p>{entry.summary}</p>
          {entry.reason && <p className="admin-log-reason"><b>Motivo:</b> {entry.reason}</p>}
          {detailsText(entry.details) && <small className="admin-log-details">{detailsText(entry.details)}</small>}
        </div>
      </article>)}
    </div>
  </section>;
}
