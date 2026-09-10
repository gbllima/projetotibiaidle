import { useEffect, useState } from 'react';
import { storedToken } from '../api/client.js';

type PublicStats = { beta: 'open' | 'closed'; accounts: number; characters: number; hunting: number; monsters: number };
type Props = { onPlay: () => void };

export function HomeScreen({ onPlay }: Props) {
  const [stats, setStats] = useState<PublicStats | null>(null);
  useEffect(() => {
    void fetch('/api/public-stats').then((r) => r.ok ? r.json() : Promise.reject()).then(setStats).catch(() => setStats(null));
  }, []);
  const actionLabel = storedToken() ? 'CONTINUAR JOGANDO' : 'JOGAR AGORA';

  return (
    <main className="landing-page">
      <div className="landing-glow landing-glow-a" aria-hidden /><div className="landing-glow landing-glow-b" aria-hidden />
      <header className="landing-nav">
        <div className="landing-brand"><span>TI</span> TIBIA IDLE</div>
        <nav><a href="#servidor">SERVIDOR</a><a href="#ranking">RANKING</a><a href="#sistemas">SISTEMAS</a></nav>
        <button className="landing-nav-play" onClick={onPlay}>{actionLabel}</button>
      </header>
      <section className="landing-hero">
        <div className="landing-hero-copy">
          <div className="landing-eyebrow"><span /> MMORPG IDLE DE NAVEGADOR</div>
          <h1>SEU PERSONAGEM<br /><em>NUNCA PARA.</em></h1>
          <p>Entre em um mundo inspirado em Tibia, escolha sua vocação, monte sua caçada e continue evoluindo mesmo quando estiver offline.</p>
          <div className="landing-actions"><button className="landing-primary" onClick={onPlay}>{actionLabel} <b>→</b></button><a className="landing-secondary" href="#servidor">CONHECER O SERVIDOR</a></div>
        </div>
        <div className="landing-hero-art" aria-hidden><div className="landing-sigil">TI</div><div className="landing-orbit landing-orbit-one" /><div className="landing-orbit landing-orbit-two" /><div className="landing-pixel-particles">✦　·　✧　　·　✦</div></div>
      </section>
      <section id="servidor" className="landing-stats">
        <Stat label="STATUS" value={stats?.beta === 'open' ? 'ONLINE' : 'OFFLINE'} accent={stats?.beta === 'open'} />
        <Stat label="PERSONAGENS" value={stats ? stats.characters.toLocaleString('pt-BR') : '—'} />
        <Stat label="CONTAS" value={stats ? stats.accounts.toLocaleString('pt-BR') : '—'} />
        <Stat label="CAÇANDO AGORA" value={stats ? stats.hunting.toLocaleString('pt-BR') : '—'} />
      </section>
      <section id="ranking" className="landing-section">
        <div className="landing-section-heading"><div><span>01</span><h2>O SERVIDOR EM TEMPO REAL</h2></div><p>Dados públicos do seu servidor, atualizados diretamente pela API do jogo.</p></div>
        <div className="landing-data-grid">
          <DataCard icon="◈" value={stats?.characters} label="PERSONAGENS CRIADOS" text="Todos os personagens do mundo compartilhado aparecem aqui conforme o servidor registra novos aventureiros." large />
          <DataCard icon="⚔" value={stats?.hunting} label="EM CAÇADA" text="Personagens com uma hunt ativa neste momento." />
          <DataCard icon="✦" value={stats?.monsters} label="MONSTROS DISPONÍVEIS" text="Conteúdo carregado da base de dados do servidor." />
        </div>
      </section>
      <section id="sistemas" className="landing-features">
        <div className="landing-section-heading"><div><span>02</span><h2>UMA AVENTURA IDLE</h2></div><p>Progressão clara, elegante e sempre conectada ao seu servidor.</p></div>
        <div className="landing-feature-grid"><Feature icon="⚔" title="VOCATIONS" text="Escolha seu estilo de combate e construa seu personagem." /><Feature icon="◉" title="HUNTS" text="Selecione criaturas e deixe sua evolução acontecer." /><Feature icon="◆" title="LOOT & GOLD" text="Colete recursos, venda seu loot e fortaleça seu equipamento." /><Feature icon="♜" title="MUNDO ONLINE" text="Um servidor compartilhado com dados reais dos jogadores." /></div>
      </section>
      <section className="landing-cta"><div><span>PRONTO PARA COMEÇAR?</span><h2>SUA AVENTURA<br /><em>COMEÇA AGORA.</em></h2></div><button className="landing-primary" onClick={onPlay}>{actionLabel} <b>→</b></button></section>
      <footer className="landing-footer">TIBIA IDLE <span>•</span> MMORPG IDLE DE NAVEGADOR</footer>
    </main>
  );
}

function Stat({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) { return <div className="landing-stat"><span className={accent ? 'online-dot' : ''} /><small>{label}</small><strong>{value}</strong></div>; }
function DataCard({ icon, value, label, text, large = false }: { icon: string; value?: number; label: string; text: string; large?: boolean }) { return <div className={`landing-data-card${large ? ' large' : ''}`}><span className="data-icon">{icon}</span><strong>{value === undefined ? '—' : value.toLocaleString('pt-BR')}</strong><small>{label}</small><p>{text}</p></div>; }
function Feature({ icon, title, text }: { icon: string; title: string; text: string }) { return <article className="landing-feature"><span>{icon}</span><h3>{title}</h3><p>{text}</p></article>; }
