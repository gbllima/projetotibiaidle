import './PortalScreen.css';
import './PortalMonsters.css';

type Props = {
  onKnockHunt: () => void;
  onKnockMonsters: () => void;
};

export function PortalScreen({ onKnockHunt, onKnockMonsters }: Props) {
  return (
    <main className="kock-portal">
      <div className="kock-portal__mist kock-portal__mist--one" aria-hidden />
      <div className="kock-portal__mist kock-portal__mist--two" aria-hidden />
      <div className="kock-portal__grid" aria-hidden />

      <header className="kock-portal__header">
        <div className="kock-games-logo" aria-label="Kock Games">
          <img src="/home/Logo%20Empresa.png" alt="Kock Games" />
        </div>
        <p>UM PORTAL. VÁRIOS MUNDOS.</p>
      </header>

      <section className="kock-portal__content" aria-labelledby="kock-portal-title">
        <div className="kock-portal__intro">
          <span className="kock-portal__eyebrow">ESCOLHA SUA AVENTURA</span>
          <h1 id="kock-portal-title">Qual mundo você quer explorar?</h1>
          <p>Entre em um dos universos da Kock Games. Seus próximos personagens, hunts e conquistas começam aqui.</p>
        </div>

        <div className="kock-game-grid">
          <button type="button" className="kock-game-card kock-game-card--tibia" onClick={onKnockHunt}>
            <span className="kock-game-card__glow" aria-hidden />
            <span className="kock-game-card__status kock-game-card__status--online">
              <i aria-hidden /> ONLINE
            </span>
            <span className="kock-game-card__art">
              <img src="/home/Hunt.png" alt="Knock Hunt BR" />
            </span>
            <span className="kock-game-card__body">
              <span className="kock-game-card__genre">IDLE MMORPG • BRASIL</span>
              <strong>Knock Hunt BR</strong>
              <span>Hunts, party, evolução de skills, bosses e progressão contínua em um mundo inspirado nos clássicos MMORPGs.</span>
            </span>
            <span className="kock-game-card__cta">ENTRAR NO JOGO <b aria-hidden>›</b></span>
          </button>

          <button type="button" className="kock-game-card kock-game-card--monsters" onClick={onKnockMonsters}>
            <span className="kock-game-card__glow" aria-hidden />
            <span className="kock-game-card__status kock-game-card__status--development">
              <i aria-hidden /> EM DESENVOLVIMENTO
            </span>
            <span className="kock-game-card__art kock-game-card__art--monsters">
              <img src="/home/Monster.png" alt="Knock Monsters BR" />
              <span className="monster-blue-orb" aria-hidden><i /></span>
            </span>
            <span className="kock-game-card__body">
              <span className="kock-game-card__genre kock-game-card__genre--blue">MONSTER IDLE RPG • BRASIL</span>
              <strong>Knock Monsters BR</strong>
              <span>Capture criaturas, monte seu time, evolua seus monstros e avance em uma nova aventura idle da Kock Games.</span>
            </span>
            <span className="kock-game-card__cta kock-game-card__cta--blue">CONHECER O PROJETO <b aria-hidden>›</b></span>
          </button>
        </div>
      </section>

      <footer className="kock-portal__footer">
        <span>© 2026 Kock Games</span>
        <span className="kock-portal__footer-dot" aria-hidden>•</span>
        <span>Feito para quem cresceu jogando RPG.</span>
      </footer>
    </main>
  );
}
