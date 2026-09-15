import { useEffect } from 'react';
import './MonstersHomeScreen.css';

type Props = {
  onPortal: () => void;
};

const FEATURES = [
  {
    icon: '◉',
    title: 'CAPTURE',
    text: 'Encontre criaturas, monte sua coleção e descubra monstros com estilos e funções diferentes.',
  },
  {
    icon: '✦',
    title: 'EVOLUA',
    text: 'Treine seu time, desenvolva atributos e desbloqueie novas formas de fortalecer cada criatura.',
  },
  {
    icon: '⚔',
    title: 'BATALHE',
    text: 'Monte formações para enfrentar áreas, desafios, chefes e outros conteúdos de progressão.',
  },
  {
    icon: '⌁',
    title: 'EXPLORE',
    text: 'Avance por regiões diferentes, descubra novas espécies e amplie sua jornada continuamente.',
  },
] as const;

const ROADMAP = [
  ['01', 'COLEÇÃO DE MONSTROS', 'Captura, raridades, atributos e organização da equipe.'],
  ['02', 'BATALHAS IDLE', 'Combates automáticos com progressão mesmo quando você estiver longe.'],
  ['03', 'EVOLUÇÃO & BUILDS', 'Treino, evolução, habilidades e especializações para cada criatura.'],
  ['04', 'MUNDO & DESAFIOS', 'Regiões, bosses, eventos e objetivos de longo prazo.'],
] as const;

export function MonstersHomeScreen({ onPortal }: Props) {
  useEffect(() => {
    const previous = document.title;
    document.title = 'Knock Monsters BR';
    return () => { document.title = previous; };
  }, []);

  return (
    <main className="monsters-site">
      <div className="monsters-orb monsters-orb--left" aria-hidden />
      <div className="monsters-orb monsters-orb--right" aria-hidden />
      <div className="monsters-grid-bg" aria-hidden />

      <header className="monsters-nav">
        <button className="monsters-back" type="button" onClick={onPortal}>← PORTAL KOCK GAMES</button>
        <div className="monsters-nav-brand">
          <img src="/home/Monster.png" alt="Knock Monsters BR" />
          <div><strong>KNOCK MONSTERS BR</strong><small>MONSTER IDLE RPG</small></div>
        </div>
        <span className="monsters-dev-badge"><i /> EM DESENVOLVIMENTO</span>
      </header>

      <section className="monsters-hero">
        <div className="monsters-hero-copy">
          <span className="monsters-kicker">NOVO UNIVERSO KOCK GAMES</span>
          <h1>CAPTURE.<br /><em>EVOLUA.</em><br />DOMINE.</h1>
          <p>Um novo RPG idle brasileiro focado em criaturas, formação de equipe, evolução e exploração contínua.</p>
          <div className="monsters-actions">
            <a href="#conceito" className="monsters-primary">CONHECER O PROJETO <b>→</b></a>
            <a href="#roadmap" className="monsters-secondary">VER ROADMAP</a>
          </div>
          <div className="monsters-mini-stats">
            <span><b>IDLE</b><small>progressão contínua</small></span>
            <span><b>MONSTERS</b><small>coleção e evolução</small></span>
            <span><b>BR</b><small>feito para o Brasil</small></span>
          </div>
        </div>

        <div className="monsters-hero-visual">
          <div className="monsters-logo-halo" aria-hidden />
          <div className="monsters-ball-ring monsters-ball-ring--outer" aria-hidden />
          <div className="monsters-ball-ring monsters-ball-ring--inner" aria-hidden />
          <img src="/home/Monster.png" alt="Logo Knock Monsters BR" />
          <div className="monsters-blue-core" aria-hidden><i /></div>
        </div>
      </section>

      <section id="conceito" className="monsters-section monsters-concept">
        <div className="monsters-section-heading">
          <span>01 · CONCEITO</span>
          <h2>SEU TIME. SUA ESTRATÉGIA.<br /><em>SUA JORNADA.</em></h2>
          <p>Knock Monsters BR nasce como um universo próprio da Kock Games, com foco em colecionar criaturas e fazê-las evoluir ao longo do tempo.</p>
        </div>
        <div className="monsters-feature-grid">
          {FEATURES.map((feature) => (
            <article key={feature.title}>
              <span className="monsters-feature-icon">{feature.icon}</span>
              <h3>{feature.title}</h3>
              <p>{feature.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="monsters-flow">
        <div className="monsters-flow-copy">
          <span>02 · LOOP DO JOGO</span>
          <h2>ENTRE, PREPARE O TIME<br />E DEIXE A AVENTURA CONTINUAR.</h2>
          <p>A proposta é combinar decisões rápidas quando você estiver online com uma progressão que continua acontecendo fora do jogo.</p>
        </div>
        <div className="monsters-flow-line">
          <div><b>1</b><strong>EXPLORE</strong><small>encontre novas áreas</small></div>
          <i />
          <div><b>2</b><strong>CAPTURE</strong><small>aumente sua coleção</small></div>
          <i />
          <div><b>3</b><strong>EVOLUA</strong><small>fortaleça seu time</small></div>
          <i />
          <div><b>4</b><strong>AVANCE</strong><small>desbloqueie desafios</small></div>
        </div>
      </section>

      <section id="roadmap" className="monsters-section monsters-roadmap">
        <div className="monsters-section-heading">
          <span>03 · ROADMAP INICIAL</span>
          <h2>O UNIVERSO ESTÁ<br /><em>SENDO CONSTRUÍDO.</em></h2>
        </div>
        <div className="monsters-roadmap-list">
          {ROADMAP.map(([number, title, text]) => (
            <article key={number}>
              <b>{number}</b>
              <div><strong>{title}</strong><p>{text}</p></div>
              <span>EM DESENVOLVIMENTO</span>
            </article>
          ))}
        </div>
      </section>

      <section className="monsters-final-cta">
        <img src="/home/Monster.png" alt="" aria-hidden />
        <div><span>NOVO MUNDO KOCK GAMES</span><h2>KNOCK MONSTERS BR</h2><p>Capturar. Evoluir. Batalhar. Explorar.</p></div>
        <button type="button" onClick={onPortal}>VOLTAR AO PORTAL</button>
      </section>

      <footer className="monsters-footer">
        <span>© 2026 Kock Games</span><i>•</i><span>Knock Monsters BR · Em desenvolvimento</span>
      </footer>
    </main>
  );
}
