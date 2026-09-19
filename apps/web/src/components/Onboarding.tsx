import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CharacterView } from '../api/types.js';
import { useLocale } from '../i18n/Locale.js';
import './Onboarding.css';

type Rect = { left: number; top: number; width: number; height: number };
type Target = { rect: Rect; selector: string };
const TOTAL = 18;
// Bump the saved-step base whenever the tutorial sequence changes so players
// who stopped midway through an older version restart with the correct steps.
const SAVED_BASE = 60;

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
    if ((saved === 13 || saved === 14 || saved === 15) && !trainingActive) return 12;
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
    else if (step === 11 && !active && !queued) void advance(12);
    else if (step === 12 && huntsOpen) void advance(huntMode === 'training' ? 14 : 13);
    else if (step === 13 && huntsOpen && huntMode === 'training') void advance(14);
    else if (step === 14 && trainingActive) void advance(15);
    else if (step === 16 && !trainingActive) void advance(17);
  }, [step, helperOpen, huntsOpen, huntMode, trainingActive, active, queued, busy, gameBusy, failedStep, closed]);

  const mobile = viewport.width < 600;
  let selectors: string[] = [];
  if (step === 1) selectors = ['[data-tutorial="helper"]', '[data-tutorial="mobile-menu"]'];
  if (step === 2) selectors = ['.helper-main h3', '.helper-main'];
  if (step === 3 || (step === 4 && (!huntsOpen || huntMode !== 'hunts') && !queued)) selectors = ['[data-tutorial="hunts"]'];
  if (step === 4 && huntsOpen && huntMode === 'hunts' && !queued) selectors = ['[data-tutorial="hunt-option"]:not(:disabled)', '.hunt-list', '[data-tab="hunts"]'];
  if (step === 4 && queued) selectors = ['.queue-card'];
  if (step === 5) selectors = ['.action-bar__panel', '.action-bar'];
  if (step === 6) selectors = mobile
    ? ['[data-tutorial="party-vitals"]', '#party-config']
    : ['[data-tutorial="vitals"]', '[data-tutorial="party-vitals"]'];
  if (step === 7) selectors = ['#stamina'];
  if (step === 8) selectors = ['#backpack-panel'];
  if (step === 9) selectors = ['#loot-pouch'];
  if (step === 10) selectors = ['#supply-pouch'];
  if (step === 11) selectors = ['[data-tutorial="city"]'];
  if (step === 12) selectors = ['[data-tutorial="hunts"]'];
  if (step === 13) selectors = ['[data-tutorial="training-tab"]', '[data-tab="training"]'];
  if (step === 14) selectors = ['[data-tutorial="training-option"]:not(:disabled)', '.training-browser'];
  if (step === 15) selectors = ['.training-hud-card', '.training-viewport'];
  if (step === 16) selectors = ['[data-tutorial="training-exit"]'];
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
        const guidedDockTarget = matched.includes('party-vitals')
          || matched === '#party-config'
          || matched === '#stamina'
          || matched === '#backpack-panel'
          || matched === '#loot-pouch'
          || matched === '#supply-pouch';
        element.scrollIntoView({ block: guidedDockTarget ? 'center' : 'nearest', inline: 'nearest', behavior: 'instant' });
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
      'Acesse o ícone Hunts',
      queued ? 'Você entrou na fila' : 'Escolha o inimigo e a caçada',
      'Conheça sua barra de magias',
      'HP, MP e XP: o que significam',
      'ST: conheça sua Stamina',
      'Backpack: seu inventário',
      'Loot Pouch: o que você coleta',
      'Supply Pouch: seus consumíveis',
      'Volte para a cidade',
      'Abra Hunts novamente',
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
      'Open the Hunts icon',
      queued ? 'You joined the queue' : 'Choose the enemy and hunt',
      'Meet your spell bar',
      'HP, MP and XP: what they mean',
      'ST: understand Stamina',
      'Backpack: your inventory',
      'Loot Pouch: what you collect',
      'Supply Pouch: your consumables',
      'Return to the city',
      'Open Hunts again',
      'Open Online Training',
      'Choose a training room',
      'You entered Online Training',
      'Leave training',
      'You know the basics!',
    ];

  const descriptions = pt ? [
    'Você vai aprender na prática: configurar o Helper, abrir Hunts, escolher inimigos, entender a barra de magias, conhecer seus status e organizar Backpack, Loot Pouch e Supply Pouch antes de conhecer o Treino online.',
    target?.selector.includes('mobile-menu')
      ? 'No celular, toque em Menu e depois em Helper. É nele que você configura poções, cura e magias automáticas.'
      : 'Clique no Helper destacado. É nele que você configura poções, cura e magias automáticas do personagem.',
    'HP é sua vida e MP é sua mana. Confira as poções e os limites de cura. Exemplo: 70% significa usar a cura quando sua vida cair abaixo desse valor. Depois confirme abaixo.',
    'Agora clique no ícone Hunts destacado. É por ele que você escolhe onde e contra quais inimigos o personagem vai caçar.',
    queued
      ? 'A caçada escolhida está cheia e você entrou na fila. Assim que surgir uma vaga, o combate começa automaticamente.'
      : !huntsOpen || huntMode !== 'hunts'
        ? 'A lista de caçadas foi fechada. Clique novamente em Hunts para continuar.'
        : target?.selector === '.hunt-list'
          ? 'Não apareceu uma opção disponível nessa lista. Troque a região ou os filtros e confira ouro e suprimentos.'
          : 'Cada opção mostra os inimigos daquela caçada, nível recomendado, XP/h e custo de suprimentos. Escolha qual inimigo quer enfrentar e clique em uma caçada liberada para entrar.',
    'Esta é a barra de magias na parte inferior. Ela mostra seus ataques, magias e atalhos principais. Durante a hunt, essas habilidades são usadas conforme a configuração do personagem e do Helper.',
    mobile
      ? 'No celular, o tutorial levou você até as barras do seu personagem dentro de Party. HP (Health Points) é sua vida: se chegar a 0, o personagem morre. MP (Mana Points) é a mana usada em magias, ataques e curas. XP (Experience) é a experiência: ao completar a barra você sobe de nível e libera novas hunts e sistemas.'
      : 'Estas barras mostram três recursos básicos. HP (Health Points) é sua vida: se chegar a 0, o personagem morre. MP (Mana Points) é a mana usada em magias, ataques e curas. XP (Experience) é a experiência: ao completar a barra você sobe de nível e libera novas hunts e sistemas.',
    'ST significa Stamina. Esta janela mostra sua energia de caça e o tempo restante. A Stamina diminui enquanto você caça e se recupera quando o personagem descansa. Ela também afeta o rendimento: com Stamina zerada, você fica sem XP da caça e o Loot Pouch deixa de receber loot.',
    'A Backpack é o inventário principal do personagem. Aqui ficam itens que você quer guardar, usar ou equipar. Você também pode mover itens da Backpack para a Supply Pouch ou para o Depot. O espaço disponível depende da capacidade da mochila equipada.',
    'O Loot Pouch recebe os itens derrubados pelos monstros durante a hunt. É a bolsa de loot da caçada. Você pode vender o conteúdo, proteger itens para não serem vendidos, impedir a coleta de certos drops e configurar para onde cada tipo de item deve ir.',
    'A Supply Pouch guarda os suprimentos usados para manter o personagem lutando, como poções de vida, poções de mana e flechas. Os itens configurados nela ficam disponíveis para consumo durante a hunt. Manter suprimentos suficientes é importante para a sobrevivência e para hunts mais longas.',
    'Clique em Cidade para encerrar a hunt e voltar ao mapa da cidade.',
    'Agora abra Hunts novamente. Além das caçadas, esse menu também dá acesso ao Treino online.',
    'Clique na aba Treino online destacada. Ali ficam as salas com dummies para aumentar suas skills.',
    'Escolha uma sala e clique em Entrar. Cada sala mostra os dummies disponíveis e a skill que será treinada.',
    'No Treino online seu personagem bate nos dummies para evoluir a skill. Se houver cargas de exercise, elas também são utilizadas durante o treino.',
    'Clique em Sair para voltar à cidade. Você pode acessar o Treino online novamente pelo menu Hunts ou pelo botão Treino no celular.',
    guest
      ? 'Agora você já entende Helper, hunts, barra de magias, HP/MP/XP/ST, Backpack, Loot Pouch, Supply Pouch, cidade e Treino online. Reivindique sua conta de visitante para não perder o personagem.'
      : 'Agora você já entende Helper, hunts, barra de magias, HP/MP/XP/ST, Backpack, Loot Pouch, Supply Pouch, cidade e Treino online. Você pode rever este tutorial nas Configurações.',
  ] : [
    'You will learn by doing: configure Helper, open Hunts, choose enemies, understand the spell bar, learn your status bars and organize Backpack, Loot Pouch and Supply Pouch before trying Online Training.',
    target?.selector.includes('mobile-menu')
      ? 'On mobile, tap Menu and then Helper. This is where automatic potions, healing and spells are configured.'
      : 'Click the highlighted Helper. This is where automatic potions, healing and spells are configured.',
    'HP is health and MP is mana. Check your potions and healing thresholds. For example, 70% means healing when health drops below that value. Then confirm below.',
    'Click the highlighted Hunts icon. This is where you choose where to hunt and which enemies your character will fight.',
    queued
      ? 'The selected hunt is full and you joined the queue. Combat starts automatically when a slot opens.'
      : !huntsOpen || huntMode !== 'hunts'
        ? 'The hunt list was closed. Click Hunts again to continue.'
        : target?.selector === '.hunt-list'
          ? 'No available option is visible. Change region or filters and check gold and supplies.'
          : 'Each option shows the enemies in that hunt, recommended level, XP/h and supply cost. Choose the enemy you want to fight and click an unlocked hunt to enter.',
    'This is the spell bar at the bottom. It shows your attacks, spells and main shortcuts. During a hunt, these abilities are used according to your character and Helper configuration.',
    mobile
      ? 'On mobile, the tutorial brought you to your character bars inside Party. HP (Health Points) is life: at 0 the character dies. MP (Mana Points) is mana used by spells, attacks and healing. XP (Experience) fills as you gain experience; completing it raises your level and unlocks hunts and systems.'
      : 'These bars show three basic resources. HP (Health Points) is life: at 0 the character dies. MP (Mana Points) is mana used by spells, attacks and healing. XP (Experience) fills as you gain experience; completing it raises your level and unlocks hunts and systems.',
    'ST means Stamina. This window shows your hunting energy and remaining time. Stamina decreases while hunting and recovers while the character rests. It also affects rewards: at zero Stamina, hunting gives no XP and the Loot Pouch stops receiving loot.',
    'The Backpack is your main inventory. It holds items you want to keep, use or equip. You can also move items from it to the Supply Pouch or Depot. Available space depends on the equipped backpack capacity.',
    'The Loot Pouch receives items dropped by monsters during a hunt. You can sell its contents, protect items from selling, ignore unwanted drops and configure where each kind of item should go.',
    'The Supply Pouch stores supplies used to keep fighting, such as health potions, mana potions and arrows. Configured items are available for consumption during hunts. Keeping enough supplies is important for survival and longer hunts.',
    'Click City to stop the hunt and return to the city map.',
    'Open Hunts again. Besides hunting locations, this menu also gives access to Online Training.',
    'Click the highlighted Online Training tab. It contains rooms with dummies used to improve your skills.',
    'Choose a room and click Enter. Each room shows its available dummies and the skill that will be trained.',
    'In Online Training your character attacks dummies to improve the skill. Exercise charges are also used when available.',
    'Click Leave to return to the city. You can access Online Training again from Hunts or the Training button on mobile.',
    guest
      ? 'You now understand Helper, hunts, the spell bar, HP/MP/XP/ST, Backpack, Loot Pouch, Supply Pouch, city and Online Training. Claim your guest account so you do not lose the character.'
      : 'You now understand Helper, hunts, the spell bar, HP/MP/XP/ST, Backpack, Loot Pouch, Supply Pouch, city and Online Training. You can replay this tutorial in Settings.',
  ];
  const right = Math.max(12, viewport.width - panelSize.width - 16);
  const bottom = Math.max(12, viewport.height - panelSize.height - (mobile ? 82 : 16));
  const positions = [{ left: right, top: bottom }, { left: right, top: 12 }, { left: 12, top: bottom }, { left: 12, top: 12 }];
  const leftPositions = [{ left: 12, top: bottom }, { left: 12, top: 12 }];
  const pouchStep = step >= 8 && step <= 10;
  function overlap(pos: { left: number; top: number }) {
    if (!target) return 0;
    const r = target.rect;
    return Math.max(0, Math.min(pos.left + panelSize.width + 12, r.left + r.width) - Math.max(pos.left - 12, r.left))
      * Math.max(0, Math.min(pos.top + panelSize.height + 12, r.top + r.height) - Math.max(pos.top - 12, r.top));
  }
  const position = step === 0 || step === 17
    ? { left: Math.max(12, (viewport.width - panelSize.width) / 2), top: Math.max(12, (viewport.height - panelSize.height) / 2) }
    : pouchStep
      ? [...leftPositions].sort((a, b) => overlap(a) - overlap(b))[0]!
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
          : step === 5 ? <button className="guided-tutorial__primary" disabled={busy || gameBusy} onClick={() => void advance(6)}>{pt ? 'Entendi a barra →' : 'I understand the bar →'}</button>
          : step === 6 ? <button className="guided-tutorial__primary" disabled={busy || gameBusy} onClick={() => void advance(7)}>{pt ? 'Agora veja a Stamina →' : 'Now see Stamina →'}</button>
          : step === 7 ? <button className="guided-tutorial__primary" disabled={busy || gameBusy} onClick={() => void advance(8)}>{pt ? 'Entendi a Stamina →' : 'I understand Stamina →'}</button>
          : step === 8 ? <button className="guided-tutorial__primary" disabled={busy || gameBusy} onClick={() => void advance(9)}>{pt ? 'Entendi a Backpack →' : 'I understand the Backpack →'}</button>
          : step === 9 ? <button className="guided-tutorial__primary" disabled={busy || gameBusy} onClick={() => void advance(10)}>{pt ? 'Entendi o Loot Pouch →' : 'I understand the Loot Pouch →'}</button>
          : step === 10 ? <button className="guided-tutorial__primary" disabled={busy || gameBusy} onClick={() => void advance(11)}>{pt ? 'Entendi a Supply Pouch →' : 'I understand the Supply Pouch →'}</button>
          : step === 15 ? <button className="guided-tutorial__primary" disabled={busy || gameBusy} onClick={() => void advance(16)}>{pt ? 'Entendi. Como saio?' : 'Got it. How do I leave?'}</button>
          : step === 17 ? <button className="guided-tutorial__primary" disabled={busy} onClick={() => void advance(99)}>{pt ? 'Concluir tutorial' : 'Finish tutorial'}</button>
          : <span className="guided-tutorial__waiting">{busy ? (pt ? 'Salvando…' : 'Saving…') : (pt ? 'Faça a ação destacada para continuar.' : 'Perform the highlighted action to continue.')}</span>}
        {!target && !busy && step === 1 && <button onClick={onOpenHelper}>{pt ? 'Abrir Helper' : 'Open Helper'}</button>}
        {!target && !busy && (step === 3 || (step === 4 && (!huntsOpen || huntMode !== 'hunts') && !queued) || step === 12) && <button onClick={onOpenHunts}>{pt ? 'Abrir Hunts' : 'Open Hunts'}</button>}
        {!target && !busy && (step === 13 || (step === 14 && !trainingActive)) && <button onClick={onOpenTraining}>{pt ? 'Abrir Treino online' : 'Open Online Training'}</button>}
        {!target && !busy && step === 16 && trainingActive && <button onClick={onLeaveTraining}>{pt ? 'Sair do treino' : 'Leave training'}</button>}
      </footer>
    </section>
  </>, document.body);
}
