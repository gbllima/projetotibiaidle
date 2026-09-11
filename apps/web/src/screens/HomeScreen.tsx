import { useEffect, useState, type ReactNode } from 'react';
import { CreatureIcon } from '../components/CreatureIcon.js';
import { itemIconUrl } from '../render/itemIcon.js';
import { storedToken } from '../api/client.js';

type PublicStats = { beta: 'open' | 'closed'; accounts: number; characters: number; hunting: number; monsters: number };
type Props = { onPlay: () => void; onWiki: () => void; onAccount: () => void };

const SWORD_HOME = new URL('../../../../home/swordhome.gif', import.meta.url).href;
const HUNTS_HOME = new URL('../../../../home/hunts.png', import.meta.url).href;
const KNOCK_LOGO = new URL('../../../../home/knock-idle-br-logo.png', import.meta.url).href;

export function HomeScreen({ onPlay, onWiki, onAccount }: Props) {
  const [stats, setStats] = useState<PublicStats | null>(null);
  useEffect(() => {
    void fetch('/api/public-stats').then((r) => r.ok ? r.json() : Promise.reject()).then(setStats).catch(() => setStats(null));
  }, []);
  const actionLabel = storedToken() ? 'CONTINUAR JOGANDO' : 'JOGAR AGORA';

  return (
    <main className="landing-page">
      <div className="landing-glow landing-glow-a" aria-hidden /><div className="landing-glow landing-glow-b" aria-hidden />
      <header className="landing-nav">
        <div className="landing-brand">
          <img src={KNOCK_LOGO} alt="Knock Idle BR" />
          <div><strong>KNOCK IDLE BR</strong><small>O RPG IDLE BRASILEIRO</small></div>
        </div>
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
        <div className="landing-hero-art">
          <div className="landing-logo-frame"><img className="landing-hero-logo" src={KNOCK_LOGO} alt="Knock Idle BR — O RPG Idle Brasileiro" /></div>
        </div>
      </section>

      <section id="servidor" className="landing-stats">
        <Stat label="STATUS" value={stats?.beta === 'open' ? 'ONLINE' : 'OFFLINE'} accent={stats?.beta === 'open'} />
        <Stat label="PERSONAGENS" value={stats ? stats.characters.toLocaleString('pt-BR') : '—'} />
        <Stat label="CONTAS" value={stats ? stats.accounts.toLocaleString('pt-BR') : '—'} />
        <Stat label="CAÇANDO AGORA" value={stats ? stats.hunting.toLocaleString('pt-BR') : '—'} />
      </section>

      <section id="ranking" className="landing-section">
        <div className="landing-section-heading"><div><span>01</span><h2>O MUNDO ESTÁ VIVO</h2></div><p>Dados públicos do servidor atualizados diretamente pelo jogo.</p></div>
        <div className="landing-data-grid">
          <DataCard sprite={<LandingItemSprite itemId={3351} size={48} />} value={stats?.characters} label="PERSONAGENS CRIADOS" text="Aventureiros que já começaram sua jornada no Knock Idle BR." large />
          <DataCard sprite={<LandingItemSprite itemId={3350} size={48} />} value={stats?.hunting} label="EM CAÇADA" text="Personagens enfrentando criaturas neste momento." />
          <DataCard sprite={<CreatureIcon lookType={34} size={48} />} value={stats?.monsters} label="MONSTROS DISPONÍVEIS" text="Criaturas espalhadas pelas áreas e hunts do servidor." />
        </div>
      </section>

      <section id="sistemas" className="landing-features">
        <div className="landing-section-heading"><div><span>02</span><h2>CONSTRUA SUA LENDA</h2></div><p>Um RPG idle com alma de MMORPG clássico e progressão que continua com você offline.</p></div>
        <div className="landing-feature-grid">
          <Feature sprite={<LandingSprite src={SWORD_HOME} />} title="VOCAÇÕES" text="Escolha seu estilo de combate e desenvolva seu personagem." />
          <Feature sprite={<LandingSprite src={HUNTS_HOME} />} title="HUNTS" text="Explore áreas, enfrente criaturas e evolua continuamente." />
          <Feature sprite={<LandingItemSprite itemId={3031} />} title="LOOT & GOLD" text="Colete recursos, negocie itens e fortaleça seu equipamento." />
          <Feature sprite={<LandingSprite src="/assets/item-icons/2979.webp" />} title="MUNDO ONLINE" text="Compartilhe o servidor com outros aventureiros brasileiros." />
        </div>
      </section>

      <section className="landing-cta"><div><span>PRONTO PARA COMEÇAR?</span><h2>ENTRE NO MUNDO DO<br /><em>KNOCK IDLE BR.</em></h2></div><button className="landing-primary" onClick={onPlay}>{actionLabel} <b>→</b></button></section>
      <div className="landing-portal-links"><button onClick={onWiki}>WIKI E TUTORIAL</button><button onClick={onAccount}>MINHA CONTA</button></div>
      <footer className="landing-footer"><strong>KNOCK IDLE BR</strong> <span>•</span> O RPG IDLE BRASILEIRO</footer>
    </main>
  );
}

function Stat({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) { return <div className="landing-stat"><span className={accent ? 'online-dot' : ''} /><small>{label}</small><strong>{value}</strong></div>; }
function LandingSprite({ src, size = 32 }: { src: string; size?: number }) {
  return <img className="landing-title-sprite" src={src} alt="" width={size} height={size} style={{ width: size, height: size }} />;
}
function LandingItemSprite({ itemId, size = 32 }: { itemId: number; size?: number }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void itemIconUrl(itemId).then((url) => { if (live) setSrc(url); }).catch(() => {});
    return () => { live = false; };
  }, [itemId]);
  return src ? <LandingSprite src={src} size={size} /> : <span className="landing-title-sprite" aria-hidden />;
}
function DataCard({ value, label, text, sprite, large = false }: { value?: number; label: string; text: string; sprite: ReactNode; large?: boolean }) {
  return <div className={`landing-data-card${large ? ' large' : ''}`}><div className="landing-data-value-row"><span className="landing-title-sprite" aria-hidden>{sprite}</span><strong>{value === undefined ? '?' : value.toLocaleString('pt-BR')}</strong></div><small>{label}</small><p>{text}</p></div>;
}
function Feature({ sprite, title, text }: { sprite: ReactNode; title: string; text: string }) {
  return <article className="landing-feature"><div className="landing-title-row"><h3>{title}</h3><span className="landing-title-sprite" aria-hidden>{sprite}</span></div><p>{text}</p></article>;
}
