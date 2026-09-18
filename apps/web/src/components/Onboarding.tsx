import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CharacterView } from '../api/types.js';
import { useLocale } from '../i18n/Locale.js';
import './Onboarding.css';

type Rect = { left: number; top: number; width: number; height: number };
type Target = { rect: Rect; selector: string };
const TOTAL = 13;
const SAVED_BASE = 20;

export function Onboarding({ character, guest = false, replay = false, helperOpen, huntsOpen, huntMode, trainingActive, gameBusy,
  onSave, onClose, onCloseHelper, onOpenHelper, onOpenHunts, onOpenTraining, onLeaveTraining,
}: {
  character: CharacterView;
  guest?: boolean;
  replay?: boolean;
  helperOpen: boolean;
  huntsOpen: boolean;
  huntMode: 'hunts' | 'training' | null;
  trainingActive: boolean;
  gameBusy: boolean;
  onSave: (step: number) => Promise<void>;
  onClose: () => void;
  onCloseHelper: () => void;
  onOpenHelper: () => void;
  onOpenHunts: () => void;
  onOpenTraining: () => void;
  onLeaveTraining: () => void;
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
    if (saved === 4 && (!huntsOpen || huntMode !== 'hunts') && !active && !queued) return 3;
    if ((saved === 8 || saved === 9) && !trainingActive) return 7;
    if ((saved === 10 || saved === 11) && !trainingActive) return 7;
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

  // Progress depends on confirmed game state, never merely on clicking a highlighted control.
  useEffect(() => {
    if (closed || busy || gameBusy || failedStep !== null) return;
    if (step === 1 && helperOpen) void advance(2);
    else if (step === 2 && !helperOpen && seenHelper.current) void advance(3);
    else if (step === 3 && active) void advance(5);
    else if (step === 3 && huntsOpen && huntMode === 'hunts') void advance(4);
    else if (step === 4 && active) void advance(5);
    else if (step === 6 && !active && !queued) void advance(7);
    else if (step === 7 && huntsOpen) void advance(huntMode === 'training' ? 9 : 8);
    else if (step === 8 && huntsOpen && huntMode === 'training') void advance(9);
    else if (step === 9 && trainingActive) void advance(10);
    else if (step === 11 && !trainingActive) void advance(12);
  }, [step, helperOpen, huntsOpen, huntMode, trainingActive, active, queued, busy, gameBusy, failedStep, closed]);

  let selectors: string[] = [];
  if (step === 1) selectors = ['[data-tutorial="helper"]', '[data-tutorial="mobile-menu"]'];
  if (step === 2) selectors = ['.helper-main h3', '.helper-main'];
  if (step === 3 || (step === 4 && (!huntsOpen || huntMode !== 'hunts') && !queued)) selectors = ['[data-tutorial="hunts"]'];
  if (step === 4 && huntsOpen && huntMode === 'hunts' && !queued) selectors = ['[data-tutorial="hunt-option"]:not(:disabled)', '.hunt-list', '[data-tab="hunts"]'];
  if (step === 4 && queued) selectors = ['.queue-card'];
  if (step === 5) selectors = ['[data-tutorial="vitals"]', '.topnav'];
  if (step === 6) selectors = ['[data-tutorial="city"]'];
  if (step === 7) selectors = ['[data-tutorial="hunts"]'];
  if (step === 8) selectors = ['[data-tutorial="training-tab"]', '[data-tab="training"]'];
  if (step === 9) selectors = ['[data-tutorial="training-option"]:not(:disabled)', '.training-browser'];
  if (step === 10) selectors = ['.training-hud-card', '.training-viewport'];
  if (step === 11) selectors = ['[data-tutorial="training-exit"]'];
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
    ? [
      `Vamos aprender jogando, ${character.name}?`,
      'Abra o Helper',
      'Confira sua cura automática',
      'Abra a lista de caçadas',
      queued ? 'Você está na fila' : 'Escolha uma caçada e entre',
      'Sua primeira luta está acontecendo!',
      'Volte para a cidade',
      'Agora vamos conhecer o Treino online',
      'Abra a aba Treino online',
      'Escolha uma sala de treino',
      'Você entrou no Treino online',
      'Saia do treino',
      'Você aprendeu o essencial!',
    ]
    : [
      `Let’s learn by playing, ${character.name}!`,
      'Open Helper',
      'Check automatic healing',
      'Open the hunt list',
      queued ? 'You are in the queue' : 'Choose a hunt and enter',
      'Your first fight is happening!',
      'Return to the city',
      'Now let’s see Online Training',
      'Open the Online Training tab',
      'Choose a training room',
      'You entered Online Training',
      'Leave training',
      'You know the basics!',
    ];

  const descriptions = pt ? [
    'Vou destacar onde clicar. Você vai configurar o Helper, aprender a escolher uma caçada, entrar em uma hunt e depois conhecer o Treino online. Pode pular a qualquer momento.',
    target?.selector.includes('mobile-menu')
      ? 'No celular, toque em Menu, que está destacado. Depois toque em Helper. É nele que você configura poções, cura e magias automáticas.'
      : 'Clique no Helper destacado. É nele que você configura poções, cura e magias automáticas do personagem.',
    'HP é sua vida e MP é a mana usada nas magias. Confira as poções e os limites de cura. Exemplo: 70% significa usar a cura quando sua vida cair abaixo desse valor. Depois confirme abaixo.',
    'Clique em Hunts no local destacado. Esse botão abre a seleção de caçadas disponíveis para seu nível.',
    queued
      ? 'Essa caçada está cheia e você entrou na fila. O combate começa assim que surgir uma vaga.'
      : !huntsOpen || huntMode !== 'hunts'
        ? 'A lista de caçadas foi fechada. Clique novamente em Hunts para continuar.'
        : target?.selector === '.hunt-list'
          ? 'Não apareceu uma caçada disponível nessa lista. Confira região, filtros, ouro e suprimentos. O tutorial espera até você conseguir entrar.'
          : 'Aqui você escolhe onde caçar. Veja o nível indicado, monstros, XP/h e custo de suprimentos. Você também pode escolher por região. Clique em uma caçada liberada para entrar.',
    'Pronto: você está em uma hunt. O personagem luta automaticamente. HP é vida, MP é mana e XP é experiência. Loot são os itens deixados pelos monstros. A hunt continua mesmo se você fechar a aba.',
    'Clique em Cidade para encerrar a caçada e voltar ao mapa da cidade.',
    'Hunts também dá acesso ao Treino online. Clique novamente em Hunts para eu mostrar onde ele fica.',
    'Agora clique na aba Treino online destacada. Nela ficam as salas com dummies para evoluir suas skills.',
    'Escolha uma sala disponível e clique em Entrar. Cada sala mostra os dummies disponíveis e a skill que será treinada.',
    'No Treino online seu personagem fica batendo nos dummies para evoluir a skill. Se possuir cargas de exercise, elas também são usadas durante o treino.',
    'Clique em Sair para voltar à cidade. Você pode retornar ao Treino online sempre que quiser pelo menu de Hunts ou pelo botão Treino no celular.',
    guest
      ? 'Agora você já sabe configurar o Helper, escolher e entrar em uma hunt, voltar para a cidade e usar o Treino online. Reivindique sua conta de visitante para não perder o personagem. Você pode rever este tutorial nas Configurações.'
      : 'Agora você já sabe configurar o Helper, escolher e entrar em uma hunt, voltar para a cidade e usar o Treino online. Para rever este guia, abra Configurações → Rever tutorial.',
  ] : [
    'I will highlight where to click. You will configure Helper, choose and enter a hunt, then learn Online Training. You can skip at any time.',
    target?.selector.includes('mobile-menu')
      ? 'On mobile, tap the highlighted Menu and then Helper. This is where automatic potions, healing and spells are configured.'
      : 'Click the highlighted Helper. This is where automatic potions, healing and spells are configured.',
    'HP is health and MP is mana used by spells. Check your potions and healing thresholds. For example, 70% means healing below that health level. Then confirm below.',
    'Click the highlighted Hunts button. It opens the hunt selection available for your level.',
    queued
      ? 'This hunt is full and you joined the queue. Combat starts as soon as a slot opens.'
      : !huntsOpen || huntMode !== 'hunts'
        ? 'The hunt list was closed. Click Hunts again to continue.'
        : target?.selector === '.hunt-list'
          ? 'No available hunt is visible in this list. Check region, filters, gold and supplies. The tutorial waits until you can enter.'
          : 'Choose where to hunt here. Check level, monsters, XP/h and supply cost. You can also browse by region. Click an unlocked hunt to enter.',
    'You are now in a hunt. Your character fights automatically. HP is health, MP is mana and XP is experience. Loot is dropped by monsters. The hunt keeps running even if you close the tab.',
    'Click City to stop the hunt and return to the city map.',
    'Hunts also gives access to Online Training. Open Hunts again so I can show you where it is.',
    'Click the highlighted Online Training tab. It contains rooms with dummies used to raise your skills.',
    'Choose an available room and click Enter. Each room shows its dummies and the skill that will be trained.',
    'In Online Training your character attacks dummies to improve the selected skill. Exercise charges are also used when available.',
    'Click Leave to return to the city. You can enter Online Training again from Hunts, or from the Training button on mobile.',
    guest
      ? 'You now know Helper, hunts, returning to the city and Online Training. Claim your guest account so you do not lose the character. Replay this tutorial in Settings.'
      : 'You now know Helper, hunts, returning to the city and Online Training. Replay this guide from Settings → Replay tutorial.',
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
  const position = step === 0 || step === 12
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
          : step === 10 ? <button className="guided-tutorial__primary" disabled={busy || gameBusy} onClick={() => void advance(11)}>{pt ? 'Entendi. Como saio?' : 'Got it. How do I leave?'}</button>
          : step === 12 ? <button className="guided-tutorial__primary" disabled={busy} onClick={() => void advance(99)}>{pt ? 'Concluir tutorial' : 'Finish tutorial'}</button>
          : <span className="guided-tutorial__waiting">{busy ? (pt ? 'Salvando…' : 'Saving…') : (pt ? 'Faça a ação destacada para continuar.' : 'Perform the highlighted action to continue.')}</span>}
        {!target && !busy && step === 1 && <button onClick={onOpenHelper}>{pt ? 'Abrir Helper' : 'Open Helper'}</button>}
        {!target && !busy && (step === 3 || (step === 4 && (!huntsOpen || huntMode !== 'hunts') && !queued) || step === 7) && <button onClick={onOpenHunts}>{pt ? 'Abrir Hunts' : 'Open Hunts'}</button>}
        {!target && !busy && (step === 8 || (step === 9 && !trainingActive)) && <button onClick={onOpenTraining}>{pt ? 'Abrir Treino online' : 'Open Online Training'}</button>}
        {!target && !busy && step === 11 && trainingActive && <button onClick={onLeaveTraining}>{pt ? 'Sair do treino' : 'Leave training'}</button>}
      </footer>
    </section>
  </>, document.body);
}
