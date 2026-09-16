import { useEffect, useMemo, useState } from 'react';
import { storedToken } from '../api/client.js';
import './AccountAdminCoinLogs.css';

type CoinOrder = {
  id: number;
  accountId: number;
  username: string;
  packId: string;
  coins: number;
  brl: number;
  status: string;
  createdAt: number;
};

type CoinTransaction = {
  id: string;
  action: 'shop_spend' | 'purchase_paid' | 'redeem_credit' | 'admin_grant';
  accountId: number;
  username?: string;
  characterId?: number;
  actor?: string;
  summary: string;
  coins: number;
  direction: 'credit' | 'debit';
  balance?: number;
  details?: Record<string, unknown>;
  createdAt: number;
};

type CoinLogResponse = {
  generatedAt: number;
  limit: number;
  orders: CoinOrder[];
  transactions: CoinTransaction[];
  counts: { orders: number; paid: number; pending: number; transactions: number };
  totals: { purchasedCoins: number; purchasedBrl: number; spentCoins: number };
};

function formatDate(value: number) {
  return value ? new Date(value).toLocaleString('pt-BR') : '—';
}

function brl(value: number) {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function detailText(details?: Record<string, unknown>) {
  if (!details) return '';
  return Object.entries(details)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .slice(0, 6)
    .map(([key, value]) => `${key}: ${String(value)}`)
    .join(' · ');
}

export function AccountAdminCoinLogs() {
  const [data, setData] = useState<CoinLogResponse | null>(null);
  const [tab, setTab] = useState<'orders' | 'transactions'>('orders');
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(500);
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
      const response = await fetch(`/api/admin/knock-coins-log?limit=${nextLimit}`, {
        headers: { authorization: `Bearer ${token}` },
      });
      const payload = await response.json() as CoinLogResponse & { error?: string };
      if (!response.ok) throw new Error(payload.error || 'Não foi possível carregar o log de Knock Coins.');
      setData(payload);
      setLimit(nextLimit);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível carregar o log de Knock Coins.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void refresh(500); }, []);

  const orders = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('pt-BR');
    if (!data) return [];
    if (!needle) return data.orders;
    return data.orders.filter((entry) =>
      `${entry.id} ${entry.username} ${entry.packId} ${entry.status} ${entry.coins}`
        .toLocaleLowerCase('pt-BR')
        .includes(needle),
    );
  }, [data, query]);

  const transactions = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('pt-BR');
    if (!data) return [];
    if (!needle) return data.transactions;
    return data.transactions.filter((entry) =>
      `${entry.actor ?? ''} ${entry.username ?? ''} ${entry.summary} ${detailText(entry.details)}`
        .toLocaleLowerCase('pt-BR')
        .includes(needle),
    );
  }, [data, query]);

  return <section className="portal-card admin-coins-panel">
    <header className="admin-coins-heading">
      <div>
        <small>FINANCEIRO · KNOCK COINS</small>
        <h2>Log de Knock Coins</h2>
        <p>Pedidos de compra da moeda e histórico de itens, serviços e recursos adquiridos com KC.</p>
      </div>
      <button className="btn" disabled={loading} onClick={() => { void refresh(); }}>{loading ? 'Atualizando…' : 'Atualizar'}</button>
    </header>

    {error && <p className="portal-error" role="alert">{error}</p>}

    <div className="admin-coins-summary">
      <article><small>Compras pagas</small><b>{data?.counts.paid ?? 0}</b></article>
      <article><small>Pendentes</small><b>{data?.counts.pending ?? 0}</b></article>
      <article><small>KC comprados</small><b>{(data?.totals.purchasedCoins ?? 0).toLocaleString('pt-BR')}</b></article>
      <article><small>Receita registrada</small><b>{brl(data?.totals.purchasedBrl ?? 0)}</b></article>
      <article><small>KC gastos</small><b>{(data?.totals.spentCoins ?? 0).toLocaleString('pt-BR')}</b></article>
    </div>

    <div className="admin-coins-tabs">
      <button className={tab === 'orders' ? 'on' : ''} onClick={() => setTab('orders')}>Compras de KC <b>{data?.counts.orders ?? 0}</b></button>
      <button className={tab === 'transactions' ? 'on' : ''} onClick={() => setTab('transactions')}>Uso de KC <b>{data?.counts.transactions ?? 0}</b></button>
    </div>

    <div className="admin-coins-toolbar">
      <label>Buscar<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Conta, personagem, produto, pedido…" /></label>
      <label>Quantidade<select value={limit} disabled={loading} onChange={(event) => { void refresh(Number(event.target.value)); }}>
        <option value={500}>500</option>
        <option value={1000}>1.000</option>
        <option value={2500}>2.500</option>
        <option value={5000}>5.000</option>
      </select></label>
    </div>

    <div className="admin-coins-list">
      {tab === 'orders' ? (
        orders.length === 0 ? <p>Nenhum pedido encontrado.</p> : orders.map((entry) => <article className="admin-coins-entry" key={`order-${entry.id}`}>
          <div className="admin-coins-entry-top">
            <span className={`admin-coins-status ${entry.status === 'paid' ? 'paid' : 'pending'}`}>{entry.status === 'paid' ? 'PAGO' : entry.status.toUpperCase()}</span>
            <strong>Pedido #{entry.id}</strong>
            <time>{formatDate(entry.createdAt)}</time>
          </div>
          <p><b>{entry.username}</b> solicitou <b>{entry.coins.toLocaleString('pt-BR')} KC</b> por <b>{brl(entry.brl)}</b>.</p>
          <small>Conta #{entry.accountId} · pacote {entry.packId}</small>
        </article>)
      ) : (
        transactions.length === 0 ? <p>Nenhuma movimentação de KC registrada.</p> : transactions.map((entry) => <article className={`admin-coins-entry ${entry.direction}`} key={entry.id}>
          <div className="admin-coins-entry-top">
            <span className={`admin-coins-direction ${entry.direction}`}>{entry.direction === 'debit' ? `−${entry.coins} KC` : `+${entry.coins} KC`}</span>
            <strong>{entry.actor || entry.username || `Conta #${entry.accountId}`}</strong>
            <time>{formatDate(entry.createdAt)}</time>
          </div>
          <p>{entry.summary}</p>
          <small>
            conta: {entry.username ?? `#${entry.accountId}`}
            {entry.balance !== undefined ? ` · saldo após: ${entry.balance.toLocaleString('pt-BR')} KC` : ''}
          </small>
          {detailText(entry.details) && <small className="admin-coins-details">{detailText(entry.details)}</small>}
        </article>)
      )}
    </div>
  </section>;
}
