import { useEffect, useState, type ReactNode } from 'react';
import { CreatureIcon } from '../components/CreatureIcon.js';
import { itemIconUrl } from '../render/itemIcon.js';
import { storedToken } from '../api/client.js';
import '../launch-notice.css';

type PublicStats = { beta: 'open' | 'closed'; accounts: number; characters: number; hunting: number; monsters: number };
type Props = { onPlay: () => void; onWiki: () => void; onAccount: () => void };

const SWORD_HOME = '/home/swordhome.gif';
const HUNTS_HOME = '/home/hunts.png';
const KNOCK_LOGO = '/home/knock-idle-br-logo.png';

export function HomeScreen({ onPlay, onWiki, onAccount }: Props) {
  const [stats, setStats] = useState<PublicStats | null>(null);
  const [launchNoticeOpen, setLaunchNoticeOpen] = useState(true);
  useEffect(() => {
    void fetch('/api/public-stats').then((r) => r.ok ? r.json() : Promise.reject()).then(setStats).catch(() => setStats(null));
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
            <p>Prepare seu personagem para o início oficial do <strong>Knock Idle BR</strong>. O servidor será inaugurado em <strong>5 de dezembro de 2026</strong>.</p>
            <button className="launch-notice-action" type="button" onClick={() => setLaunchNoticeOpen(false)}>ENTENDI — CONTINUAR NO SITE</button>
          </div>
        </div>
      )}

      <div className="landing-glow landing-glow-a" aria-hidden /><div className="landing-glow landing-glow-b" aria-hidden />
      <header className="landing-nav">
        <div className="landing-brand"><img src={KNOCK_LOGO} alt="Knock Idle BR" /><div><strong>KNOCK IDLE BR</strong><small>O RPG IDLE BRASILEIRO</small></div></div>
        <nav><a href="#servidor">SERVIDOR</a><a href="#ranking">RANKING</a><a href="#sistemas">SISTEMAS</a><button className="landing-nav-link" onClick={onWiki}>WIKI</button><button className="landing-nav-link" onClick={onAccount}>MINHA CONTA</button></nav>
        <button className="landing-nav-play" onClick={onPlay}>{actionLabel}</button>
      </header>

      <section className="landing-hero">
        <div className="landing-hero-copy">
          <div className="landing-eyebrow"><span /> O RPG IDLE BRASILEIRO</div>
          <h1>SUA AVENTURA<br /><em>NUNCA PARA.</em></h1>
          <p>Entre em um mundo de fantasia inspirado nos clássicos MMORPGs, escolha sua vocação, monte sua caçada e continue evoluindo mesmo quando estiver offline.</p>
          <div className="landing-actions"><button className="landing-primary" onClick={onPlay}>{actionLabel} <b>→</b></button><a className="landing-secondary" href="#servidor">CONHECER O SERVIDOR</a></div>
          <div className="landing-br-badge"><span>BR</span><div><strong>FEITO PARA QUEM GOSTA DE RPG</strong><small>Progressão idle, hunts, loot e evolução constante.</small></div></div>
        </div>
        <div className="landing-hero-art"><div className="landing-logo-frame"><img className="landing-hero-logo" src={KNOCK_LOGO} alt="Knock Idle BR — O RPG Idle Brasileiro" /></div></div>
      </section>

      <section className="landing-fair-economy" aria-label="Economia justa">
        <div className="landing-fair-seal"><span>⚖</span><strong>FAIR PLAY</strong></div>
        <div className="landing-fair-copy"><small>ECONOMIA JUSTA</small><h2>NÃO É <em>PAY-TO-WIN</em></h2><p>Seu progresso vem do jogo. Evolução, hunts, loot e conquistas são construídos jogando — dinheiro não compra vitória.</p></div>
        <div className="landing-fair-points"><span>✓ PROGRESSÃO PELO JOGO</span><span>✓ ECONOMIA EQUILIBRADA</span><span>✓ COMPETIÇÃO JUSTA</span></div>
      </section>

      <section id="servidor" className="landing-stats">
        <Stat label="STATUS" value={stats?.beta === 'open' ? 'ONLINE' : 'OFFLINE'} accent={stats?.beta === 'open'} /><Stat label="PERSONAGENS" value={stats ? stats.characters.toLocaleString('pt-BR') : '—'} /><Stat label="CONTAS" value={stats ? stats.accounts.toLocaleString('pt-BR') : '—'} /><Stat label="CAÇANDO AGORA" value={stats ? stats.hunting.toLocaleString('pt-BR') : '—'} />
      </section>

      <section id="ranking" className="landing-section">
        <div className="landing-section-heading"><div><span>01</span><h2>O MUNDO ESTÁ VIVO</h2></div><p>Dados públicos do servidor atualizados diretamente pelo jogo.</p></div>
        <div className="landing-data-grid"><DataCard sprite={<LandingItemSprite itemId={3351} size={48} />} value={stats?.characters} label="PERSONAGENS CRIADOS" text="Aventureiros que já começaram sua jornada no Knock Idle BR." large /><DataCard sprite={<LandingItemSprite itemId={3350} size={48} />} value={stats?.hunting} label="EM CAÇADA" text="Personagens enfrentando criaturas neste momento." /><DataCard sprite={<CreatureIcon lookType={34} size={48} />} value={stats?.monsters} label="MONSTROS DISPONÍVEIS" text="Criaturas espalhadas pelas áreas e hunts do servidor." /></div>
      </section>

      <section id="sistemas" className="landing-features">
        <div className="landing-section-heading"><div><span>02</span><h2>CONSTRUA SUA LENDA</h2></div><p>Um RPG idle com alma de MMORPG clássico e progressão que continua com você offline.</p></div>
        <div className="landing-feature-grid"><Feature sprite={<LandingSprite src={SWORD_HOME} />} title="VOCAÇÕES" text="Escolha seu estilo de combate e desenvolva seu personagem." /><Feature sprite={<LandingSprite src={HUNTS_HOME} />} title="HUNTS" text="Explore áreas, enfrente criaturas e evolua continuamente." /><Feature sprite={<LandingItemSprite itemId={3031} />} title="LOOT & GOLD" text="Colete recursos, negocie itens e fortaleça seu equipamento." /><Feature sprite={<LandingSprite src="/assets/item-icons/2979.webp" />} title="MUNDO ONLINE" text="Compartilhe o servidor com outros aventureiros brasileiros." /></div>
      </section>

      <section className="landing-cta"><div><span>PRONTO PARA COMEÇAR?</span><h2>ENTRE NO MUNDO DO<br /><em>KNOCK IDLE BR.</em></h2></div><button className="landing-primary" onClick={onPlay}>{actionLabel} <b>→</b></button></section>
      <div className="landing-portal-links"><button onClick={onWiki}>WIKI E TUTORIAL</button><button onClick={onAccount}>MINHA CONTA</button></div>
      <footer className="landing-footer"><strong>KNOCK IDLE BR</strong> <span>•</span> O RPG IDLE BRASILEIRO</footer>
    </main>
  );
}

function Stat({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) { return <div className="landing-stat"><span className={accent ? 'online-dot' : ''} /><small>{label}</small><strong>{value}</strong></div>; }
function LandingSprite({ src, size = 32 }: { src: string; size?: number }) { return <img className="landing-title-sprite" src={src} alt="" width={size} height={size} style={{ width: size, height: size }} />; }
function LandingItemSprite({ itemId, size = 32 }: { itemId: number; size?: number }) { const [src, setSrc] = useState<string | null>(null); useEffect(() => { let live = true; void itemIconUrl(itemId).then((url) => { if (live) setSrc(url); }).catch(() => {}); return () => { live = false; }; }, [itemId]); return src ? <LandingSprite src={src} size={size} /> : <span className="landing-title-sprite" aria-hidden />; }
function DataCard({ value, label, text, sprite, large = false }: { value?: number; label: string; text: string; sprite: ReactNode; large?: boolean }) { return <div className={`landing-data-card${large ? ' large' : ''}`}><div className="landing-data-value-row"><span className="landing-title-sprite" aria-hidden>{sprite}</span><strong>{value === undefined ? '?' : value.toLocaleString('pt-BR')}</strong></div><small>{label}</small><p>{text}</p></div>; }
function Feature({ sprite, title, text }: { sprite: ReactNode; title: string; text: string }) { return <article className="landing-feature"><div className="landing-title-row"><h3>{title}</h3><span className="landing-title-sprite" aria-hidden>{sprite}</span></div><p>{text}</p></article>; }
