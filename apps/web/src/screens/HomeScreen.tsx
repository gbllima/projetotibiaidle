import { useEffect, useState, type ReactNode } from 'react';
import { CreatureIcon } from '../components/CreatureIcon.js';
import { itemIconUrl } from '../render/itemIcon.js';
import { storedToken } from '../api/client.js';
import '../launch-notice.css';
import './HomeNews.css';
import './HomeServerStatus.css';

type PublicStats = { beta: 'open' | 'closed'; accounts: number; characters: number; online: number; hunting: number; monsters: number };
type NewsItem = { id: string; title: string; category: string; summary: string; body: string; publishedAt: number; updatedAt: number };
type ServerStatus = 'checking' | 'online' | 'offline';
type Props = { onPlay: () => void; onWiki: () => void; onAccount: () => void };

const SWORD_HOME = '/home/swordhome.gif';
const HUNTS_HOME = '/home/hunts.png';
const KNOCK_LOGO = '/home/Hunt.png';

export function HomeScreen({ onPlay, onWiki, onAccount }: Props) {
  const [stats, setStats] = useState<PublicStats | null>(null);
  const [serverStatus, setServerStatus] = useState<ServerStatus>('checking');
  const [news, setNews] = useState<NewsItem[]>([]);
  const [launchNoticeOpen, setLaunchNoticeOpen] = useState(true);

  useEffect(() => {
    let mounted = true;
    const loadStats = () => {
      void fetch('/api/public-stats')
        .then((r) => r.ok ? r.json() : Promise.reject())
        .then((payload: PublicStats) => {
          if (!mounted) return;
          setStats(payload);
          setServerStatus('online');
        })
        .catch(() => {
          if (!mounted) return;
          setStats(null);
          setServerStatus('offline');
        });
    };

    loadStats();
    const statsTimer = window.setInterval(loadStats, 10_000);

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

  const actionLabel = storedToken() ? 'CONTINUAR JOGANDO' : 'JOGAR AGORA';

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

      <div className="landing-glow landing-glow-a" aria-hidden /><div className="landing-glow landing-glow-b" aria-hidden />
      <header className="landing-nav">
        <div className="landing-brand"><img src={KNOCK_LOGO} alt="Knock Hunt BR" /><div><strong>KNOCK HUNT BR</strong><small>O RPG IDLE BRASILEIRO</small></div></div>
        <nav><a href="#servidor">SERVIDOR</a><a href="#noticias">NOTÍCIAS</a><a href="#ranking">RANKING</a><a href="#sistemas">SISTEMAS</a><button className="landing-nav-link" onClick={onWiki}>WIKI</button><button className="landing-nav-link" onClick={onAccount}>MINHA CONTA</button></nav>
        <button className="landing-nav-play" onClick={onPlay}>{actionLabel}</button>
      </header>

      <section className="landing-hero">
        <div className="landing-hero-copy">
          <div className="landing-eyebrow"><span /> O RPG IDLE BRASILEIRO</div>
          <h1>JOGUE EM<br />QUALQUER LUGAR.</h1>
          <p><strong>SEM DOWNLOADS. SEM INSTALAÇÃO.</strong><br />PC • ANDROID • iOS</p>
          <div className="landing-actions"><button className="landing-primary" onClick={onPlay}>{actionLabel} <b>→</b></button><a className="landing-secondary" href="#servidor">CONHECER O SERVIDOR</a></div>
          <div className="landing-br-badge"><span>BR</span><div><strong>FEITO PARA QUEM GOSTA DE RPG</strong><small>Progressão idle, hunts, loot e evolução constante.</small></div></div>
        </div>
        <div className="landing-hero-art" id="servidor">
          <div className={`landing-server-overview landing-server-overview--${serverStatus}`} role="status" aria-live="polite">
            <div className="landing-server-overview-status">
              <span className="landing-server-status-dot" aria-hidden />
              <strong>{serverStatus === 'checking' ? 'VERIFICANDO' : serverStatus === 'online' ? 'ONLINE' : 'OFFLINE'}</strong>
            </div>
            <div className="landing-server-overview-metric">
              <strong>{serverStatus === 'offline' ? '0' : stats ? stats.online.toLocaleString('pt-BR') : '—'}</strong>
              <small>PESSOAS ONLINE</small>
            </div>
            <div className="landing-server-overview-metric">
              <strong>{stats ? stats.accounts.toLocaleString('pt-BR') : '—'}</strong>
              <small>CONTAS CRIADAS</small>
            </div>
          </div>
          <div className="landing-logo-frame"><img className="landing-hero-logo" src={KNOCK_LOGO} alt="Knock Hunt BR — O RPG Idle Brasileiro" /></div>
        </div>
      </section>

      <section className="landing-fair-economy" aria-label="Economia justa">
        <div className="landing-fair-seal"><span>⚖</span><strong>FAIR PLAY</strong></div>
        <div className="landing-fair-copy"><small>ECONOMIA JUSTA</small><h2>SEM PODER <em>EXCLUSIVO PAGO</em></h2><p>Equipamentos, hunts e conquistas continuam sendo obtidos jogando. VIP e boosts aceleram ou ampliam conveniências, mas não liberam equipamentos exclusivos de poder.</p></div>
        <div className="landing-fair-points"><span>✓ EQUIPAMENTOS PELO JOGO</span><span>✓ SEM GEAR EXCLUSIVO PAGO</span><span>✓ COMPETIÇÃO TRANSPARENTE</span></div>
      </section>

      <section id="noticias" className="landing-news">
        <div className="landing-news-heading">
          <div className="landing-news-heading-copy">
            <div className="landing-news-kicker"><span>01</span><b>REGISTRO OFICIAL</b></div>
            <h2>NOTÍCIAS <em>&</em> ATUALIZAÇÕES</h2>
            <p>Novidades, changelogs, correções, eventos e tudo que foi feito no servidor Knock Hunt BR.</p>
          </div>
          <div className="landing-news-legend" aria-label="Tipos de publicação"><span>NOTÍCIAS</span><span>ATUALIZAÇÕES</span><span>CHANGELOG</span></div>
        </div>
        {news.length > 0 ? (
          <div className="landing-news-list">
            {news.slice(0, 12).map((item, index) => {
              const timestamp = item.publishedAt || item.updatedAt;
              return (
                <details className="landing-news-entry" key={item.id} open={index === 0 ? true : undefined}>
                  <summary>
                    <div className="landing-news-entry-main">
                      <div className="landing-news-entry-meta">
                        <time dateTime={new Date(timestamp).toISOString()}>{formatNewsDate(timestamp)} <span>— {formatNewsTime(timestamp)}</span></time>
                        <div className="landing-news-badges">
                          {index === 0 && <span className="landing-news-badge landing-news-badge--new">NOVO</span>}
                          <span className="landing-news-badge">{item.category || 'Novidade'}</span>
                        </div>
                      </div>
                      <h3>{item.title}</h3>
                      <p>{item.summary}</p>
                    </div>
                    <span className="landing-news-chevron" aria-hidden />
                  </summary>
                  <div className="landing-news-entry-content">
                    <div className="landing-news-content-head"><span>REGISTRO DO SERVIDOR</span><small>Publicado em {formatNewsDateLong(timestamp)} às {formatNewsTime(timestamp)}</small></div>
                    <NewsBody body={item.body} />
                  </div>
                </details>
              );
            })}
          </div>
        ) : <div className="landing-news-empty"><span>✦</span><strong>EM BREVE</strong><p>Notícias, atualizações e mudanças do servidor aparecerão aqui.</p></div>}
      </section>

      <section id="ranking" className="landing-section">
        <div className="landing-section-heading"><div><span>02</span><h2>O MUNDO ESTÁ VIVO</h2></div><p>Dados públicos do servidor atualizados diretamente pelo jogo.</p></div>
        <div className="landing-data-grid"><DataCard sprite={<LandingItemSprite itemId={3351} size={48} />} value={stats?.characters} label="PERSONAGENS CRIADOS" text="Aventureiros que já começaram sua jornada no Knock Hunt BR." large /><DataCard sprite={<LandingItemSprite itemId={3350} size={48} />} value={stats?.hunting} label="EM CAÇADA" text="Personagens enfrentando criaturas neste momento." /><DataCard sprite={<CreatureIcon lookType={34} size={48} />} value={stats?.monsters} label="MONSTROS DISPONÍVEIS" text="Criaturas espalhadas pelas áreas e hunts do servidor." /></div>
      </section>

      <section id="sistemas" className="landing-features">
        <div className="landing-section-heading"><div><span>03</span><h2>CONSTRUA SUA LENDA</h2></div><p>Um RPG idle com alma de MMORPG clássico e progressão que continua com você offline.</p></div>
        <div className="landing-feature-grid"><Feature sprite={<LandingSprite src={SWORD_HOME} />} title="VOCAÇÕES" text="Escolha seu estilo de combate e desenvolva seu personagem." /><Feature sprite={<LandingSprite src={HUNTS_HOME} />} title="HUNTS" text="Explore áreas, enfrente criaturas e evolua continuamente." /><Feature sprite={<LandingItemSprite itemId={3031} />} title="LOOT & GOLD" text="Colete recursos, negocie itens e fortaleça seu equipamento." /><Feature sprite={<LandingSprite src="/assets/item-icons/2979.webp" />} title="MUNDO ONLINE" text="Compartilhe o servidor com outros aventureiros brasileiros." /></div>
      </section>

      <section className="landing-cta"><div><span>PRONTO PARA COMEÇAR?</span><h2>ENTRE NO MUNDO DO<br /><em>KNOCK HUNT BR.</em></h2></div><button className="landing-primary" onClick={onPlay}>{actionLabel} <b>→</b></button></section>
      <div className="landing-portal-links"><button onClick={onWiki}>WIKI E TUTORIAL</button><button onClick={onAccount}>MINHA CONTA</button></div>
      <footer className="landing-footer"><strong>KNOCK HUNT BR</strong> <span>•</span> O RPG IDLE BRASILEIRO</footer>
    </main>
  );
}

function NewsBody({ body }: { body: string }) {
  const blocks: ReactNode[] = [];
  let bullets: string[] = [];
  const flushBullets = () => {
    if (!bullets.length) return;
    const items = bullets;
    bullets = [];
    blocks.push(<ul className="landing-news-change-list" key={`list-${blocks.length}`}>{items.map((item, index) => <li key={index}>{item}</li>)}</ul>);
  };

  body.split(/\r?\n/).forEach((rawLine) => {
    const line = rawLine.trim();
    if (!line) { flushBullets(); return; }
    const heading = line.match(/^#{1,3}\s+(.+)$/) ?? line.match(/^\[(.+)]$/);
    if (heading) {
      flushBullets();
      blocks.push(<h4 key={`heading-${blocks.length}`}>{heading[1]}</h4>);
      return;
    }
    const bullet = line.match(/^(?:[-•›>]|✓)\s*(.+)$/);
    if (bullet) { bullets.push(bullet[1]!); return; }
    flushBullets();
    blocks.push(<p key={`paragraph-${blocks.length}`}>{line}</p>);
  });
  flushBullets();
  return <div className="landing-news-rich-body">{blocks}</div>;
}

function formatNewsDate(timestamp: number): string { return new Date(timestamp || Date.now()).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }); }
function formatNewsDateLong(timestamp: number): string { return new Date(timestamp || Date.now()).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' }); }
function formatNewsTime(timestamp: number): string { return new Date(timestamp || Date.now()).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); }
function LandingSprite({ src, size = 32 }: { src: string; size?: number }) { return <img className="landing-title-sprite" src={src} alt="" width={size} height={size} style={{ width: size, height: size }} />; }
function LandingItemSprite({ itemId, size = 32 }: { itemId: number; size?: number }) { const [src, setSrc] = useState<string | null>(null); useEffect(() => { let live = true; void itemIconUrl(itemId).then((url) => { if (live) setSrc(url); }).catch(() => {}); return () => { live = false; }; }, [itemId]); return src ? <LandingSprite src={src} size={size} /> : <span className="landing-title-sprite" aria-hidden />; }
function DataCard({ value, label, text, sprite, large = false }: { value?: number; label: string; text: string; sprite: ReactNode; large?: boolean }) { return <div className={`landing-data-card${large ? ' large' : ''}`}><div className="landing-data-value-row"><span className="landing-title-sprite" aria-hidden>{sprite}</span><strong>{value === undefined ? '?' : value.toLocaleString('pt-BR')}</strong></div><small>{label}</small><p>{text}</p></div>; }
function Feature({ sprite, title, text }: { sprite: ReactNode; title: string; text: string }) { return <article className="landing-feature"><div className="landing-title-row"><h3>{title}</h3><span className="landing-title-sprite" aria-hidden>{sprite}</span></div><p>{text}</p></article>; }
