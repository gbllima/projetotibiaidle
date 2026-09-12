import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CharacterView } from '../api/types.js';
import { useLocale } from '../i18n/Locale.js';
import './Onboarding.css';

type Rect = { left: number; top: number; width: number; height: number };
type Target = { rect: Rect; selector: string };
const TOTAL = 8;
const SAVED_BASE = 20;

export function Onboarding({ character, guest = false, replay = false, helperOpen, huntsOpen, gameBusy,
  onSave, onClose, onCloseHelper, onOpenHelper, onOpenHunts,
}: {
  character: CharacterView;
  guest?: boolean;
  replay?: boolean;
  helperOpen: boolean;
  huntsOpen: boolean;
  gameBusy: boolean;
  onSave: (step: number) => Promise<void>;
  onClose: () => void;
  onCloseHelper: () => void;
  onOpenHelper: () => void;
  onOpenHunts: () => void;
}) {
  const { locale } = useLocale();
  const pt = locale === 'pt';
  const active = Boolean(character.session);
  const queued = Boolean(character.queue);
  const [step, setStep] = useState(() => {
    const saved = (character.onboardingStep ?? 0) - SAVED_BASE;
    if (replay || saved < 0 || saved >= TOTAL) return 0;
    // Windows are closed after login: resume at the action that opens them.
    if (saved === 2 && !helperOpen) return 1;
    if (saved === 4 && !huntsOpen && !active && !queued) return 3;
    return saved;
  });
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const [closed, setClosed] = useState(false);
  const [error, setError] = useState('');
  const [failedStep, setFailedStep] = useState<number | null>(null);
  const [target, setTarget] = useState<Target | null>(null);
  const [panelSize, setPanelSize] = useState({ width: 360, height: 220 });
  const [viewport, setViewport] = useState({ width: window.innerWidth, height: window.innerHeight });
  const panel = useRef<HTMLElement>(null);
  const seenHelper = useRef(helperOpen);
  if (helperOpen) seenHelper.current = true;

  async function advance(next: number) {
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    setError('');
    setFailedStep(null);
    try {
      await onSave(next === 99 ? 99 : SAVED_BASE + next);
      if (next === 99) {
        setClosed(true);
        onClose();
      } else {
        setStep(next);
        if (step === 2 && next === 3) onCloseHelper();
      }
    } catch {
      setError(pt ? 'Não foi possível salvar. Tente novamente.' : 'Could not save. Please try again.');
      setFailedStep(next);
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }

  // Progress depends on confirmed game state, never merely on clicking a hunt.
  useEffect(() => {
    if (closed || busy || gameBusy || failedStep !== null) return;
    if (step === 1 && helperOpen) void advance(2);
    else if (step === 2 && !helperOpen && seenHelper.current) void advance(3);
    else if (step === 3 && active) void advance(5);
    else if (step === 3 && (huntsOpen || queued)) void advance(4);
    else if (step === 4 && active) void advance(5);
    else if (step === 6 && !active && !queued) void advance(7);
  }, [step, helperOpen, huntsOpen, active, queued, busy, gameBusy, failedStep, closed]);

  let selectors: string[] = [];
  if (step === 1) selectors = ['[data-tutorial="helper"]', '[data-tutorial="mobile-menu"]'];
  if (step === 2) selectors = ['.helper-main h3', '.helper-main'];
  if (step === 3 || (step === 4 && !huntsOpen && !queued)) selectors = ['[data-tutorial="hunts"]'];
  if (step === 4 && huntsOpen && !queued) selectors = ['[data-tutorial="hunt-option"]:not(:disabled)', '.hunt-list', '[data-tab="hunts"]'];
  if (step === 4 && queued) selectors = ['.queue-card'];
  if (step === 5) selectors = ['[data-tutorial="vitals"]', '.topnav'];
  if (step === 6) selectors = ['[data-tutorial="city"]'];
  const selectorKey = selectors.join('|');

  useEffect(() => {
    if (closed) return;
    let previous: HTMLElement | null = null;
    function update() {
      let element: HTMLElement | undefined;
      let matched = '';
      for (const selector of selectorKey.split('|').filter(Boolean)) {
        const candidates = Array.from(document.querySelectorAll<HTMLElement>(selector))
          .filter((el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden');
        if (selector.includes('hunt-option')) candidates.sort((a, b) => Number(a.dataset.tutorialLevel) - Number(b.dataset.tutorialLevel));
        element = candidates[0];
        if (element) { matched = selector; break; }
      }
      if (element && element !== previous) {
        element.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
        previous = element;
      }
      const bounds = element?.getBoundingClientRect();
      const next = bounds ? { selector: matched, rect: { left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height } } : null;
      setTarget((old) => JSON.stringify(old) === JSON.stringify(next) ? old : next);
      setViewport((old) => old.width === window.innerWidth && old.height === window.innerHeight ? old : { width: window.innerWidth, height: window.innerHeight });
    }
    update();
    const timer = window.setInterval(update, 250);
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => { window.clearInterval(timer); window.removeEventListener('scroll', update, true); window.removeEventListener('resize', update); };
  }, [selectorKey, closed]);

  useEffect(() => {
    if (!panel.current) return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const rect = entry.target.getBoundingClientRect();
      setPanelSize({ width: rect.width, height: rect.height });
    });
    observer.observe(panel.current);
    return () => observer.disconnect();
  }, []);

  const titles = pt
    ? [`Vamos aprender jogando, ${character.name}?`, 'Abra o Helper', 'Confira sua cura automática', 'Abra a lista de caçadas', queued ? 'Você está na fila' : 'Selecione uma caçada', 'Sua primeira luta está acontecendo!', 'Volte para a cidade', 'Você aprendeu o essencial!']
    : [`Let’s learn by playing, ${character.name}!`, 'Open Helper', 'Check automatic healing', 'Open the hunt list', queued ? 'You are in the queue' : 'Select a hunt', 'Your first fight is happening!', 'Return to the city', 'You know the basics!'];
  const descriptions = pt ? [
    'Vou destacar onde clicar. Você vai preparar a cura, escolher uma caçada e acompanhar sua primeira luta. Pode pular a qualquer momento.',
    target?.selector.includes('mobile-menu') ? 'No celular, toque em Menu, que está destacado. Depois, toque em Helper: é onde você configura poções e magias automáticas.' : 'Clique no Helper destacado. Ele controla a cura e as magias automáticas do seu personagem.',
    'HP é sua vida; MP é a energia das magias. Confira as poções e os limites de cura. Por exemplo: 70% significa usar a cura quando a vida cair abaixo desse valor. Depois, confirme abaixo.',
    'Clique em Hunts, no local destacado. Hunt significa caçada: um lugar com monstros para enfrentar e ganhar experiência.',
    queued ? 'A caçada está ocupada. O combate começa quando surgir uma vaga. O guia continua quando você entrar; você também pode pular o tutorial.' : !huntsOpen ? 'A lista foi fechada. Clique no botão Hunts destacado para abri-la novamente.' : target?.selector === '.hunt-list' ? 'Não há uma caçada disponível nesta lista agora. Confira o ouro, os suprimentos e os filtros, ou escolha outra região. O guia espera você conseguir entrar.' : 'Clique na caçada destacada ou em outra liberada. Comece com nível mínimo baixo e confira o custo de suprimentos. A entrada inicia o combate; se faltar vaga, você vai para a fila.',
    'O personagem luta sozinho. HP é vida, MP é mana e XP é experiência para subir de nível. Observe essas barras: poções são consumidas para manter você vivo. Loot são os itens deixados pelos monstros.',
    'Clique em Cidade, no botão destacado. Isso encerra sua caçada. Fechar a aba do navegador não para o combate!',
    guest ? 'Agora você sabe preparar, caçar e parar. Depois, explore equipamentos, treino e party (sua equipe). Reivindique sua conta de visitante para guardar seu acesso. Este guia pode ser reaberto nas Configurações.' : 'Agora você sabe preparar, caçar e parar. Depois, explore equipamentos, treino e party (sua equipe). Para rever este guia, abra Configurações → Rever tutorial.',
  ] : [
    'I will highlight where to click. Prepare healing, choose a hunt and watch your first fight. You can skip at any time.',
    target?.selector.includes('mobile-menu') ? 'Tap the highlighted Menu, then Helper to configure automatic potions and spells.' : 'Click the highlighted Helper. It controls your character’s automatic healing and spells.',
    'HP is health; MP powers your spells. Check potions and healing thresholds. For example, 70% means healing below that health level. Then confirm below.',
    'Click the highlighted Hunts button. A hunt is a place to fight monsters and gain experience.',
    queued ? 'The hunt is occupied. Combat begins when a slot opens. The guide continues when you enter; you can also skip it.' : !huntsOpen ? 'The list was closed. Click the highlighted Hunts button to reopen it.' : target?.selector === '.hunt-list' ? 'No hunt is available in this list right now. Check gold, supplies and filters, or choose another region. The guide waits until you can enter.' : 'Click the highlighted hunt or another unlocked option. Start with a low minimum level and check supply costs. Entering starts combat, or joins the queue if the hunt is full.',
    'Your character fights automatically. HP is health, MP is mana and XP is experience for new levels. Watch these bars: potions are consumed to keep you alive. Loot means items dropped by monsters.',
    'Click the highlighted City button to end your hunt. Closing the browser tab does not stop combat!',
    guest ? 'You can now prepare, hunt and stop. Explore equipment, training and parties later. Claim your guest account to keep access. Replay this guide in Settings.' : 'You can now prepare, hunt and stop. Explore equipment, training and parties later. Replay this guide in Settings.',
  ];
  const mobile = viewport.width < 600;
  const right = Math.max(12, viewport.width - panelSize.width - 16);
  const bottom = Math.max(12, viewport.height - panelSize.height - (mobile ? 82 : 16));
  const positions = [{ left: right, top: bottom }, { left: right, top: 12 }, { left: 12, top: bottom }, { left: 12, top: 12 }];
  function overlap(pos: { left: number; top: number }) {
    if (!target) return 0;
    const r = target.rect;
    return Math.max(0, Math.min(pos.left + panelSize.width + 12, r.left + r.width) - Math.max(pos.left - 12, r.left))
      * Math.max(0, Math.min(pos.top + panelSize.height + 12, r.top + r.height) - Math.max(pos.top - 12, r.top));
  }
  const position = step === 0 || step === 7
    ? { left: Math.max(12, (viewport.width - panelSize.width) / 2), top: Math.max(12, (viewport.height - panelSize.height) / 2) }
    : [...positions].sort((a, b) => overlap(a) - overlap(b))[0]!;

  if (closed) return null;
  return createPortal(<>
    {target && <div className="guided-highlight" aria-hidden="true" style={{ left: target.rect.left - 4, top: target.rect.top - 4, width: target.rect.width + 8, height: target.rect.height + 8 }} />}
    <section ref={panel} className="guided-tutorial" style={position} aria-label={pt ? 'Tutorial guiado' : 'Guided tutorial'}>
      <header>
        <span>{pt ? 'APRENDA JOGANDO' : 'LEARN BY PLAYING'} · {step + 1}/{TOTAL}</span>
        <button type="button" disabled={busy} onClick={() => void advance(99)}>{pt ? 'Pular tutorial' : 'Skip tutorial'}</button>
      </header>
      <div className="guided-tutorial__progress" aria-hidden="true"><i style={{ width: `${((step + 1) / TOTAL) * 100}%` }} /></div>
      <div aria-live="polite" aria-atomic="true"><h2>{titles[step]}</h2><p>{descriptions[step]}</p></div>
      {error && <p role="alert" className="guided-tutorial__error">{error}</p>}
      <footer>
        {failedStep !== null ? <button className="guided-tutorial__primary" disabled={busy} onClick={() => void advance(failedStep)}>{pt ? 'Tentar novamente' : 'Try again'}</button>
          : step === 0 ? <button className="guided-tutorial__primary" disabled={busy} onClick={() => void advance(1)}>{pt ? 'Começar na prática →' : 'Start playing →'}</button>
          : step === 2 ? <button className="guided-tutorial__primary" disabled={busy || gameBusy} onClick={() => void advance(3)}>{pt ? 'Cura conferida →' : 'Healing checked →'}</button>
          : step === 5 ? <button className="guided-tutorial__primary" disabled={busy || gameBusy} onClick={() => void advance(6)}>{pt ? 'Entendi. Como volto?' : 'Got it. How do I return?'}</button>
          : step === 7 ? <button className="guided-tutorial__primary" disabled={busy} onClick={() => void advance(99)}>{pt ? 'Concluir tutorial' : 'Finish tutorial'}</button>
          : <span className="guided-tutorial__waiting">{busy ? (pt ? 'Salvando…' : 'Saving…') : (pt ? 'Faça a ação destacada para continuar.' : 'Perform the highlighted action to continue.')}</span>}
        {!target && !busy && step === 1 && <button onClick={onOpenHelper}>{pt ? 'Abrir Helper' : 'Open Helper'}</button>}
        {!target && !busy && (step === 3 || (step === 4 && !huntsOpen && !queued)) && <button onClick={onOpenHunts}>{pt ? 'Abrir Hunts' : 'Open Hunts'}</button>}
      </footer>
    </section>
  </>, document.body);
}
