import { useEffect, useState, type ReactNode } from 'react';
import { storedToken } from '../api/client.js';
import { itemIconUrl } from '../render/itemIcon.js';
import { outfitIconUrl } from '../render/outfitIcon.js';
import '../launch-notice.css';
import './HomeNews.css';
import './HomeServerStatus.css';

type PublicStats = {
  beta: 'open' | 'closed';
  accounts: number;
  characters: number;
  online: number;
  hunting: number;
  monsters: number;
};

type NewsItem = {
  id: string;
  title: string;
  category: string;
  summary: string;
  body: string;
  publishedAt: number;
  updatedAt: number;
};

type RankingEntry = {
  position: number;
  name: string;
  level: number;
  vocationId: number;
  online: boolean;
};

type ServerStatus = 'checking' | 'online' | 'offline';
type Props = { onPlay: () => void; onWiki: () => void; onAccount: () => void };

const KNOCK_LOGO = '/home/Hunt.png';

const vocationName = (id: number) => {
  if ([1, 5].includes(id)) return 'Sorcerer';
  if ([2, 6].includes(id)) return 'Druid';
  if ([3, 7].includes(id)) return 'Paladin';
  if ([4, 8].includes(id)) return 'Knight';
  if ([9, 10].includes(id)) return 'Monk';
  return 'Aventureiro';
};

export function HomeScreen({ onPlay, onWiki, onAccount }: Props) {
  const [stats, setStats] = useState<PublicStats | null>(null);
  const [ranking, setRanking] = useState<RankingEntry[]>([]);
  const [serverStatus, setServerStatus] = useState<ServerStatus>('checking');
  const [news, setNews] = useState<NewsItem[]>([]);
  const [launchNoticeOpen, setLaunchNoticeOpen] = useState(true);

  useEffect(() => {
    let mounted = true;

    const loadPublicData = () => {
      void Promise.all([
        fetch('/api/public-stats').then((r) => r.ok ? r.json() : Promise.reject()),
        fetch('/api/public-ranking').then((r) => r.ok ? r.json() : Promise.reject()),
      ]).then((payloads) => {
        if (!mounted) return;
        const statsPayload = payloads[0] as PublicStats;
        const rankingPayload = payloads[1] as { ranking?: RankingEntry[] };
        setStats(statsPayload);
        setRanking(Array.isArray(rankingPayload.ranking) ? rankingPayload.ranking : []);
        setServerStatus('online');
      }).catch(() => {
        if (!mounted) return;
        setServerStatus('offline');
      });
    };

    loadPublicData();
    const statsTimer = window.setInterval(loadPublicData, 15_000);

    void fetch('/api/news')
      .then((r) => r.ok ? r.json() : Promise.reject())
      .then((payload: { news?: NewsItem[] }) => {
        if (mounted) setNews(Array.isArray(payload.news) ? payload.news : []);
      })
      .catch(() => {
        if (mounted) setNews([]);
      });

    return () => {
      mounted = false;
      window.clearInterval(statsTimer);
    };
  }, []);

  const actionLabel = storedToken() ? 'CONTINUAR' : 'JOGAR AGORA';
  const latestNews = news.slice(0, 7);
  const patchNotes = news.slice(0, 6);

  return (
    <main className="landing-page">
      {launchNoticeOpen && (
        <div className="launch-notice-backdrop" role="dialog" aria-modal="true" aria-labelledby="launch-notice-title">
          <div className="launch-notice">
            <button className="launch-notice-close" type="button" aria-label="Fechar aviso" onClick={() => setLaunchNoticeOpen(false)}>×</button>
            <span className="launch-notice-kicker">⚔ ABERTURA OFICIAL DO SERVIDOR ⚔</span>
            <h2 id="launch-notice-title">A AVENTURA<br /><em>COMEÇA EM BREVE</em></h2>
            <div className="launch-notice-date"><span>●</span> 05 DE DEZEMBRO DE 2026</div>
            <p>Prepare seu personagem para o início oficial do <strong>Knock Hunt BR</strong>. O servidor será inaugurado em <strong>5 de dezembro de 2026</strong>.</p>
            <button className="launch-notice-action" type="button" onClick={() => setLaunchNoticeOpen(false)}>ENTENDI — CONTINUAR NO SITE</button>
          </div>
        </div>
      )}

      <div className="landing-ambient landing-ambient-a" aria-hidden />
      <div className="landing-ambient landing-ambient-b" aria-hidden />

      <header className="landing-nav">
        <button className="landing-brand" type="button" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
          <img src={KNOCK_LOGO} alt="" />
          <span><strong>KNOCK HUNT BR</strong><small>IDLE MMORPG</small></span>
        </button>

        <nav aria-label="Navegação principal">
          <a href="#noticias">NOVIDADES</a>
          <a href="#sistemas">POR QUE JOGAR</a>
          <a href="#ranking">HIGHSCORES</a>
          <button type="button" onClick={onWiki}>WIKI</button>
        </nav>

        <div className="landing-nav-actions">
          <span className="landing-online-pill"><i />{serverStatus === 'online' ? (stats?.online ?? 0) : '—'}</span>
          <button type="button" className="landing-account-btn" onClick={onAccount}>MINHA CONTA</button>
          <button type="button" className="landing-nav-play" onClick={onPlay}>⚔ {actionLabel}</button>
        </div>
      </header>

      <aside className="landing-quick-rail" aria-label="Acesso rápido">
        <button type="button" onClick={onWiki} title="Wiki">?</button>
        <button type="button" onClick={onAccount} title="Minha conta">♟</button>
        <button type="button" className="active" onClick={onPlay} title="Jogar">⚔</button>
      </aside>

      <section className="landing-hero" id="servidor">
        <div className="landing-hero-copy">
          <div className="landing-launch-chip">ABERTURA OFICIAL · 05/12/2026</div>
          <img className="landing-wordmark" src={KNOCK_LOGO} alt="Knock Hunt BR" />
          <div className="landing-eyebrow">O RPG IDLE BRASILEIRO</div>
          <h1>EVOLUA MESMO<br />QUANDO ESTIVER <em>OFFLINE.</em></h1>
          <p>Hunts, loot, vocações, mercado e progressão contínua direto no navegador. Entre por alguns minutos ou acompanhe sua evolução ao longo do dia.</p>

          <div className="landing-actions">
            <button className="landing-primary" onClick={onPlay}>⚔ {actionLabel}</button>
            <button className="landing-secondary" type="button" onClick={onWiki}>VER GUIA DO JOGO</button>
          </div>

          <div className="landing-hero-mini-stats">
            <span><strong>{stats?.characters?.toLocaleString('pt-BR') ?? '—'}</strong> PERSONAGENS</span>
            <span><strong>{stats?.hunting?.toLocaleString('pt-BR') ?? '—'}</strong> EM HUNT</span>
            <span><strong>{stats?.monsters?.toLocaleString('pt-BR') ?? '—'}</strong> CRIATURAS</span>
          </div>
        </div>

        <div className="landing-game-preview">
          <div className="landing-game-preview-head">
            <span><i className={serverStatus === 'online' ? 'online' : ''} /> SERVIDOR {serverStatus === 'online' ? 'ONLINE' : serverStatus === 'checking' ? 'VERIFICANDO' : 'OFFLINE'}</span>
            <small>{stats?.online ?? 0} online agora</small>
          </div>
          <div className="landing-game-preview-screen">
            <div className="landing-preview-logo-wrap">
              <img src={KNOCK_LOGO} alt="" />
              <strong>SEU PERSONAGEM NÃO PARA.</strong>
              <span>Feche o navegador. A hunt continua no servidor.</span>
            </div>
            <div className="landing-preview-bars" aria-hidden>
              <span><i style={{ width: '88%' }} /></span>
              <span><i style={{ width: '64%' }} /></span>
              <span><i style={{ width: '76%' }} /></span>
            </div>
          </div>
          <div className="landing-game-preview-foot">
            <span>HUNTS AUTOMÁTICAS</span><span>LOOT REAL</span><span>PROGRESSÃO 24H</span>
          </div>
        </div>
      </section>

      <section className="landing-trust-strip" aria-label="Destaques do servidor">
        <div><span>⚖</span><strong>ECONOMIA JUSTA</strong><small>Sem equipamentos exclusivos de poder pagos.</small></div>
        <div><span>◈</span><strong>100% NAVEGADOR</strong><small>PC e celular, sem instalação.</small></div>
        <div><span>⌛</span><strong>PROGRESSÃO IDLE</strong><small>Seu personagem continua evoluindo.</small></div>
      </section>

      <section id="noticias" className="landing-news-board">
        <div className="landing-news-main">
          <div className="landing-tab-head">
            <span className="active">▧ NOVIDADES</span>
            <span>◉ EVENTOS</span>
          </div>

          <div className="landing-news-rows">
            {latestNews.length > 0 ? latestNews.map((item, index) => {
              const timestamp = item.publishedAt || item.updatedAt;
              return (
                <details className="landing-news-row" key={item.id} open={index === 0 ? true : undefined}>
                  <summary>
                    <time>{formatNewsDate(timestamp)}</time>
                    <div><strong>{item.title}</strong><p>{item.summary}</p></div>
                    <span>{item.category || 'NOVIDADE'}</span>
                  </summary>
                  <div className="landing-news-row-body">{renderNewsBody(item.body)}</div>
                </details>
              );
            }) : (
              <div className="landing-empty-state">As próximas notícias e atualizações aparecerão aqui.</div>
            )}
          </div>
        </div>

        <aside className="landing-patch-panel">
          <h3>▣ PATCH NOTES</h3>
          <div>
            {patchNotes.length > 0 ? patchNotes.map((item) => {
              const timestamp = item.publishedAt || item.updatedAt;
              return <span key={item.id}><b>{formatNewsDateShort(timestamp)}</b><em>{item.category || 'UPDATE'}</em></span>;
            }) : <p>Nenhuma publicação disponível ainda.</p>}
          </div>
          <a href="#noticias">LER ÚLTIMAS PUBLICAÇÕES ›</a>
        </aside>
      </section>

      <section id="sistemas" className="landing-why">
        <div className="landing-section-kicker">‹ POR QUE JOGAR ›</div>
        <h2>VOCÊ JOGA NO SEU TEMPO.<br /><em>O SERVIDOR FAZ O RESTO.</em></h2>
        <p className="landing-section-lead">Uma experiência inspirada nos RPGs clássicos, construída para quem quer progressão constante sem precisar ficar preso à tela.</p>

        <div className="landing-why-grid">
          <FeatureCard icon={<img src="/home/swordhome.gif" alt="" />} title="ELE CAÇA ENQUANTO VOCÊ VIVE" text="A hunt roda no servidor. Feche a aba, trabalhe ou durma; quando voltar, seu progresso estará esperando." />
          <FeatureCard icon={<LandingOutfitSprite />} title="VOCAÇÕES QUE JOGAM DIFERENTE" text="Monte sua conta com estilos distintos e escolha como quer evoluir, lutar e compor sua party." />
          <FeatureCard icon={<LandingItemSprite itemId={28945} />} title="LOOT QUE TEM PROPÓSITO" text="Itens, ouro e recursos alimentam sua evolução. Cada caçada pode melhorar seu próximo passo." />
          <FeatureCard icon={<img src="/home/PlanetaHome.png" alt="" />} title="UM MUNDO ONLINE DE VERDADE" text="Mercado, guilds, party, ranking e jogadores compartilhando o mesmo servidor." />
        </div>
      </section>

      <section id="ranking" className="landing-ranking">
        <div className="landing-section-kicker">‹ HALL DA FAMA ›</div>
        <h2>HIGHSCORES</h2>
        <p>Top 10 por nível · atualização automática do servidor</p>

        <div className="landing-ranking-table">
          <div className="landing-ranking-head"><span>#</span><span>PERSONAGEM</span><span>VOCAÇÃO</span><span>LEVEL</span></div>
          {ranking.length > 0 ? ranking.map((entry) => (
            <div className="landing-ranking-row" key={entry.position}>
              <strong>{entry.position}</strong>
              <span className="landing-ranking-name">{entry.name}{entry.online && <i title="Online" />}</span>
              <span>{vocationName(entry.vocationId)}</span>
              <b>{entry.level}</b>
            </div>
          )) : (
            <div className="landing-ranking-empty">O ranking aparecerá quando houver personagens no servidor.</div>
          )}
        </div>
      </section>

      <section className="landing-final-cta">
        <div>
          <small>SUA LENDA COMEÇA AQUI.</small>
          <h2>CRIE SEU PERSONAGEM<br />EM MENOS DE UM MINUTO.</h2>
          <p>Grátis, no navegador e sem download.</p>
        </div>
        <button className="landing-primary" onClick={onPlay}>⚔ COMEÇAR AGORA</button>
      </section>

      <footer className="landing-footer">
        <div className="landing-footer-brand"><img src={KNOCK_LOGO} alt="" /><strong>KNOCK HUNT BR</strong></div>
        <nav><button onClick={onWiki}>Wiki</button><a href="#noticias">Novidades</a><a href="#ranking">Highscores</a><button onClick={onAccount}>Minha Conta</button></nav>
        <small>Knock Hunt BR · RPG idle independente para navegador.</small>
      </footer>
    </main>
  );
}

function FeatureCard({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return (
    <article className="landing-why-card">
      <div className="landing-why-icon">{icon}</div>
      <h3>{title}</h3>
      <p>{text}</p>
    </article>
  );
}

function LandingOutfitSprite() {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void outfitIconUrl(131, 48, { head: 114, body: 120, legs: 114, feet: 115 }, 3)
      .then((url) => {
        if (live) setSrc(url);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  return src ? <img src={src} alt="" /> : <span className="landing-why-icon-fallback">♟</span>;
}

function LandingItemSprite({ itemId }: { itemId: number }) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void itemIconUrl(itemId)
      .then((url) => {
        if (live) setSrc(url);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [itemId]);

  return src ? <img src={src} alt="" /> : <span className="landing-why-icon-fallback">▣</span>;
}

function renderNewsBody(body: string) {
  const lines = body.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return lines.slice(0, 8).map((line, index) => <p key={index}>{line.replace(/^#{1,3}\s*/, '').replace(/^(?:[-•›>]|✓)\s*/, '• ')}</p>);
}

function formatNewsDate(timestamp: number): string {
  return new Date(timestamp || Date.now()).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

function formatNewsDateShort(timestamp: number): string {
  return new Date(timestamp || Date.now()).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });
}
