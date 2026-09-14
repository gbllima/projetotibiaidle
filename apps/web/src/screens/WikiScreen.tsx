import { useMemo, useState } from 'react';
import {
  hunts,
  monsters,
  items,
  vocations,
  spellsCatalog,
  charms,
  bossEncounters,
  outfitsCatalog,
  mountsCatalog,
  stages,
} from '@tibia-idle/data';
import { GUILD_COST, partySlotPrices, SHOP, IMBUEMENTS, WHEEL_NODES } from '@tibia-idle/sim';
import { CreatureIcon } from '../components/CreatureIcon.js';
import './portal.css';
import './wiki-guide.css';

type JourneyStep = {
  number: number;
  phase: string;
  title: string;
  intro: string;
  learn: string[];
  doNow: string[];
  readyWhen: string;
  tip?: string;
  visual?: 'vocations' | 'first-hunt' | 'cycle' | 'party' | 'progression' | 'endgame';
};

const VOCATION_EXAMPLES = [
  { name: 'Knight', lookType: 131, role: 'Resistente e corpo a corpo', hint: 'Boa escolha para quem gosta de ficar perto dos monstros.' },
  { name: 'Paladin', lookType: 137, role: 'Ataque à distância', hint: 'Combina alcance, dano e boa sobrevivência.' },
  { name: 'Sorcerer', lookType: 130, role: 'Magia ofensiva', hint: 'Dano mágico forte, exige atenção a mana e proteção.' },
  { name: 'Druid', lookType: 144, role: 'Magia e suporte', hint: 'Cura, suporte e dano mágico.' },
  { name: 'Monk', lookType: 128, role: 'Combate próprio', hint: 'Estilo diferente, com habilidades e progressão próprias.' },
] as const;

const JOURNEY_STEPS: JourneyStep[] = [
  {
    number: 1,
    phase: 'COMEÇO',
    title: 'Crie seu personagem e escolha como você quer lutar',
    intro: 'Você não precisa conhecer Tibia para começar. A vocação é apenas o estilo de combate do seu personagem. Escolha pelo jeito que parece mais divertido para você, não pela ideia de “classe mais forte”.',
    learn: [
      'Knight luta perto dos inimigos e aguenta bastante dano.',
      'Paladin prefere distância e usa armas de longo alcance.',
      'Sorcerer causa muito dano mágico e depende bastante de mana.',
      'Druid mistura magia, cura e suporte.',
      'Monk possui um estilo próprio de combate e evolução.',
    ],
    doNow: [
      'Abra Minha conta e crie um personagem.',
      'Escolha um nome e uma vocação.',
      'Entre no jogo. Você aparecerá na Cidade, que é a área segura.',
    ],
    readyWhen: 'Quando você estiver dentro da Cidade e conseguir ver HP, mana, equipamento e os menus do personagem.',
    visual: 'vocations',
  },
  {
    number: 2,
    phase: 'PREPARAÇÃO',
    title: 'Entenda a Cidade antes de sair para caçar',
    intro: 'Cidade é sua base. Aqui você não está lutando. É o lugar para organizar equipamento, conferir mochila, descansar e preparar a próxima caçada.',
    learn: [
      'HP é sua vida. Se chegar a zero durante a hunt, o personagem morre e a sessão termina para ele.',
      'Mana é o recurso usado por muitas magias e habilidades.',
      'XP é experiência. Quando acumula o suficiente, seu nível aumenta.',
      'Stamina representa o tempo de caça eficiente. Ela se recupera enquanto você fica fora da hunt.',
      'Helper é o “piloto automático”: controla ataque, cura, poções, magias, fuga e outras decisões do combate.',
    ],
    doNow: [
      'Abra Itens e veja o que está equipado.',
      'Abra o Helper e confirme que ataque automático e cura estão configurados.',
      'Veja sua stamina e seu ouro antes de escolher uma hunt.',
    ],
    readyWhen: 'Quando você souber onde olhar sua vida, mana, XP e onde configurar o Helper.',
    tip: 'No começo, não tente decorar todos os sistemas. Você só precisa saber: personagem preparado → Hunt → ganhar XP e loot → voltar mais forte.',
  },
  {
    number: 3,
    phase: 'PRIMEIRA HUNT',
    title: 'Faça sua primeira caçada e aprenda o ciclo básico do jogo',
    intro: 'Hunt é a área de caça. Você escolhe uma cave liberada e o personagem combate automaticamente. A primeira referência do jogo é a Venore Rotworm Cave.',
    learn: [
      'Cave e Hunt significam, na prática, o lugar onde seu personagem vai lutar.',
      'Cada hunt possui monstros, nível de acesso, XP, loot e dificuldade diferentes.',
      'Os monstros aparecem em ondas. Ao derrotá-los, você recebe XP e pode receber loot.',
      'Loot são os itens e moedas deixados pelos monstros. Depois eles ajudam a financiar equipamentos e novas viagens.',
      'Supplies são os consumíveis da viagem, como poções e munições. Caçar tem custo.',
    ],
    doNow: [
      'Abra Hunts.',
      'Escolha uma hunt liberada para seu nível. No início, procure a Venore Rotworm Cave.',
      'Confira duração, custo e suprimentos.',
      'Inicie a hunt e observe: dano → morte do monstro → XP → loot → próxima onda.',
    ],
    readyWhen: 'Quando você entender de onde vêm XP e loot e conseguir iniciar e encerrar uma hunt sozinho.',
    visual: 'first-hunt',
  },
  {
    number: 4,
    phase: 'EVOLUÇÃO',
    title: 'Repita o ciclo: XP, nível, equipamento e hunts melhores',
    intro: 'A progressão principal é simples: você caça para ganhar XP e loot; sobe de nível; melhora seus atributos e equipamentos; então passa a aguentar hunts mais difíceis e lucrativas.',
    learn: [
      'Level é o nível geral do personagem e libera conteúdos.',
      'Skills são habilidades de combate que evoluem separadamente.',
      'Magic Level mede a evolução mágica das vocações que usam magia.',
      'Equipamento melhora ataque, defesa e outras características.',
      'Uma hunt estar liberada não significa que ela será confortável: equipamento e configuração também importam.',
    ],
    doNow: [
      'Quando uma hunt ficar fácil, abra Hunts e compare as próximas opções liberadas.',
      'Use parte do lucro para melhorar equipamento e manter suprimentos.',
      'Se estiver morrendo, volte uma etapa: hunt mais fácil, equipamento melhor ou Helper mais seguro.',
    ],
    readyWhen: 'Quando você já consegue decidir sozinho se deve continuar na cave atual ou avançar para uma mais difícil.',
    visual: 'cycle',
  },
  {
    number: 5,
    phase: 'PARTY',
    title: 'Monte uma party quando quiser evoluir personagens juntos',
    intro: 'Party é um grupo de personagens que participa da mesma hunt. No seu projeto, a formação pode ter até três personagens da mesma conta e existe um Principal que comanda a caçada.',
    learn: [
      'O Principal define a hunt e é a referência da formação.',
      'Membros ativos na mesma hunt dividem a XP dos monstros derrotados.',
      'Tank é o personagem preparado para receber pressão; DPS foca em dano; SUP oferece suporte.',
      'Se um membro morrer, os monstros dele passam a procurar outro membro vivo da party.',
      'O segundo slot custa ' + partySlotPrices(1).gold.toLocaleString('pt-BR') + ' gold e o terceiro custa ' + partySlotPrices(2).gold.toLocaleString('pt-BR') + ' gold.',
    ],
    doNow: [
      'Abra Config no painel Party.',
      'Adicione seus personagens e escolha quem será o Principal.',
      'Salve a formação e inicie uma hunt compatível.',
      'Acompanhe HP e mana de cada membro. Um membro morto fica identificado no painel.',
    ],
    readyWhen: 'Quando você entende quem é o Principal e consegue identificar quem está vivo, morto e recebendo XP.',
    visual: 'party',
  },
  {
    number: 6,
    phase: 'MIDGAME',
    title: 'Comece a usar os sistemas que aceleram e especializam sua evolução',
    intro: 'Depois que o ciclo básico já estiver natural, entram os sistemas de progressão. Não tente aprender todos no primeiro dia; vá adicionando um de cada vez.',
    learn: [
      'Bestiário: progresso por espécie de monstro conforme você derrota aquela criatura.',
      'Charms: bônus que podem ser desbloqueados e vinculados a criaturas.',
      'Prey: bônus temporários ligados a monstros, como XP, dano, defesa ou loot.',
      'Tasks: objetivos de matar determinadas criaturas para receber progresso e recompensas.',
      'Treino: melhora skills ou magic level sem depender apenas do ritmo das hunts.',
    ],
    doNow: [
      'Escolha uma criatura que você já caça bastante e acompanhe seu Bestiário.',
      'Veja se existe Prey útil para sua hunt atual.',
      'Use treino quando quiser fortalecer a habilidade principal da sua vocação.',
    ],
    readyWhen: 'Quando você já usa pelo menos um sistema de progressão além de simplesmente ganhar level.',
    visual: 'progression',
  },
  {
    number: 7,
    phase: 'ALTO NÍVEL',
    title: 'Aperfeiçoe o personagem com Imbuements, Forja, Wheel e Bosses',
    intro: 'No alto nível, a diferença deixa de ser apenas “ter mais level”. Sua configuração, equipamento e sistemas avançados passam a pesar muito mais.',
    learn: [
      'Imbuements colocam bônus temporários em equipamentos compatíveis.',
      'Forja melhora e transforma equipamentos usando recursos próprios.',
      'Wheel distribui pontos em melhorias ligadas à progressão do personagem.',
      'Bosses são encontros especiais com requisitos, recompensas e cooldowns.',
      'Bosstiário registra sua progressão contra bosses e ajuda a estruturar objetivos de longo prazo.',
    ],
    doNow: [
      'Comece por um sistema avançado de cada vez.',
      'Compare o custo de uma melhoria com o ganho real que ela traz para sua hunt.',
      'Antes de entrar em boss, confira nível mínimo, cooldown, supplies e sobrevivência da party.',
    ],
    readyWhen: 'Quando seu personagem já possui uma build planejada e você escolhe upgrades pensando no conteúdo que quer enfrentar.',
  },
  {
    number: 8,
    phase: 'ENDGAME',
    title: 'Endgame: transforme evolução em objetivos de longo prazo',
    intro: 'Endgame não é “zerar o jogo”. É quando seu foco passa de aprender o básico para otimizar personagens e completar objetivos difíceis de forma cada vez mais eficiente.',
    learn: [
      'Caçar conteúdos de alto nível com boa relação entre XP, lucro e risco.',
      'Montar parties com funções que se complementam.',
      'Completar Bestiário, Charms, Bosstiário e progressões avançadas.',
      'Otimizar equipamentos, Imbuements, Forja, Wheel e configurações do Helper.',
      'Enfrentar bosses, raids e eventos e perseguir recompensas raras.',
      'Gerenciar economia, loot, mercado e recursos para financiar novos upgrades.',
    ],
    doNow: [
      'Defina um objetivo: level, boss, item, Bestiário ou melhoria de equipamento.',
      'Ajuste sua hunt e sua build para esse objetivo.',
      'Meça se você está melhorando: sobrevivência, XP/h, lucro/h e tempo para matar.',
    ],
    readyWhen: 'Não existe “fim” obrigatório. No endgame, você escolhe qual meta quer perseguir em seguida.',
    visual: 'endgame',
  },
];

const GLOSSARY = [
  ['Hunt / Cave', 'Lugar onde o personagem combate monstros automaticamente.'],
  ['Vocação', 'A classe do personagem: Knight, Paladin, Sorcerer, Druid, Monk etc.'],
  ['XP', 'Experiência usada para subir de nível.'],
  ['Loot', 'Itens e moedas obtidos ao derrotar monstros.'],
  ['Supplies', 'Consumíveis usados na viagem, como poções e munição.'],
  ['Helper', 'Configuração automática de ataque, cura, poções, magias e segurança.'],
  ['Stamina', 'Tempo de caça eficiente; recupera enquanto o personagem descansa fora da hunt.'],
  ['Party', 'Grupo de personagens que luta na mesma hunt e pode compartilhar XP.'],
  ['Bestiário', 'Progresso individual contra cada espécie de monstro.'],
  ['Prey', 'Bônus temporário associado a uma criatura.'],
  ['Charm', 'Bônus de progressão que pode ser associado a monstros.'],
  ['Boss', 'Inimigo especial com regras, requisitos e recompensas próprias.'],
  ['Endgame', 'Fase em que o foco passa para otimização e objetivos difíceis de longo prazo.'],
] as const;

const CATALOGS = {
  Caçadas: hunts,
  Monstros: monsters,
  Itens: items,
  Vocações: vocations,
  Magias: spellsCatalog,
  'Bosses e eventos': bossEncounters,
  Charms: charms,
  Outfits: outfitsCatalog,
  Montarias: mountsCatalog,
  Imbuements: IMBUEMENTS,
  'Roda de habilidades': WHEEL_NODES,
  Loja: SHOP,
  Estágios: [stages],
};

const LABELS: Record<string, string> = {
  id: 'Identificação', name: 'Nome', description: 'Descrição', level: 'Nível mínimo', minLevel: 'Nível mínimo',
  levelRequired: 'Nível exigido', location: 'Local', monsters: 'Monstros', expectedXpPerHour: 'XP base por hora',
  expectedLootPerHour: 'Loot previsto por hora', premium: 'Premium', partySizes: 'Formações', health: 'Vida',
  experience: 'Experiência', speed: 'Velocidade', armor: 'Armadura', defense: 'Defesa', attack: 'Ataque', loot: 'Loot',
  chance: 'Chance (escala da base)', maxCount: 'Quantidade máxima', itemId: 'Item', itemName: 'Nome do item', attacks: 'Ataques',
  elements: 'Elementos', immunities: 'Imunidades', mana: 'Mana', words: 'Palavras', cooldown: 'Cooldown', vocations: 'Vocações',
  sellPrice: 'Preço de venda', buyPrice: 'Preço de compra', weight: 'Peso (base)', slot: 'Slot', type: 'Tipo', duration: 'Duração (base)',
  charges: 'Cargas', cost: 'Custo', tiers: 'Tiers', slots: 'Slots', range: 'Alcance', bonuses: 'Bônus', bestiary: 'Bestiário',
  category: 'Categoria', unlocked: 'Desbloqueado', from: 'Origem', price: 'Preço', currency: 'Moeda',
};

function DetailValue({ value, depth = 0 }: { value: unknown; depth?: number }) {
  if (value === null || value === undefined) return <span>—</span>;
  if (typeof value === 'boolean') return <span>{value ? 'Sim' : 'Não'}</span>;
  if (Array.isArray(value)) {
    return value.length
      ? <ul>{value.map((entry, index) => <li key={index}><DetailValue value={entry} depth={depth + 1} /></li>)}</ul>
      : <span>Sem registros</span>;
  }
  if (typeof value === 'object') {
    return <dl className="wiki-detail">{Object.entries(value)
      .filter(([key]) => !['clientId', 'hasSprite', 'sprites', 'flags'].includes(key))
      .map(([key, entry]) => <div key={key}><dt>{LABELS[key] ?? key.replace(/([A-Z])/g, ' $1')}</dt><dd><DetailValue value={entry} depth={depth + 1} /></dd></div>)}</dl>;
  }
  return <span>{typeof value === 'number' ? value.toLocaleString('pt-BR') : String(value)}</span>;
}

function monsterIdByName(name: string): string | undefined {
  return monsters.find((monster) => String(monster.name).toLowerCase() === name.toLowerCase())?.id;
}

function MonsterExample({ name, caption }: { name: string; caption: string }) {
  return <div className="wiki-monster-example">
    <CreatureIcon monsterId={monsterIdByName(name)} size={78} label={name} />
    <strong>{name}</strong>
    <small>{caption}</small>
  </div>;
}

function VocationVisual() {
  return <div className="wiki-vocation-grid">
    {VOCATION_EXAMPLES.map((vocation) => <article key={vocation.name}>
      <CreatureIcon lookType={vocation.lookType} size={72} label={vocation.name} />
      <div><strong>{vocation.name}</strong><span>{vocation.role}</span><small>{vocation.hint}</small></div>
    </article>)}
  </div>;
}

function FirstHuntVisual() {
  return <div className="wiki-first-hunt-visual" aria-label="Exemplo visual da primeira hunt">
    <div><CreatureIcon lookType={131} size={82} label="Seu personagem" /><strong>Você</strong><small>Ataca automaticamente</small></div>
    <span className="wiki-combat-arrow">→</span>
    <div><CreatureIcon monsterId={monsterIdByName('Rotworm')} size={92} label="Rotworm" /><strong>Rotworm</strong><small>Monstro da primeira referência</small></div>
    <span className="wiki-combat-arrow">→</span>
    <div className="wiki-reward-icon"><span>XP</span><b>+</b><strong>Loot</strong><small>Você fica mais forte</small></div>
  </div>;
}

function CycleVisual() {
  return <div className="wiki-cycle" aria-label="Ciclo de evolução">
    {['Caçar', 'Ganhar XP', 'Subir nível', 'Melhorar equipamento', 'Liberar hunt melhor'].map((label, index) => <div key={label}>
      <span>{index + 1}</span><strong>{label}</strong>{index < 4 && <b>→</b>}
    </div>)}
  </div>;
}

function PartyVisual() {
  return <div className="wiki-party-visual">
    <article><span>TANK</span><CreatureIcon lookType={131} size={70} label="Tank" /><strong>Segura pressão</strong></article>
    <article><span>DPS</span><CreatureIcon lookType={137} size={70} label="DPS" /><strong>Foca em dano</strong></article>
    <article><span>SUP</span><CreatureIcon lookType={144} size={70} label="Suporte" /><strong>Cura e ajuda</strong></article>
  </div>;
}

function ProgressionVisual({ endgame = false }: { endgame?: boolean }) {
  const examples: Array<[string, string]> = endgame
    ? [['Giant Spider', 'Conteúdo perigoso'], ['Demon', 'Alto nível'], ['Ferumbras', 'Objetivo de endgame']]
    : [['Rotworm', 'Começo'], ['Dragon', 'Intermediário'], ['Giant Spider', 'Mais exigente'], ['Demon', 'Alto nível']];
  return <div className="wiki-monster-road">
    {examples.map(([name, caption], index) => <div className="wiki-road-entry" key={name}>
      <MonsterExample name={name} caption={caption} />
      {index < examples.length - 1 && <span>→</span>}
    </div>)}
  </div>;
}

function StepVisual({ kind }: { kind: JourneyStep['visual'] }) {
  if (kind === 'vocations') return <VocationVisual />;
  if (kind === 'first-hunt') return <FirstHuntVisual />;
  if (kind === 'cycle') return <CycleVisual />;
  if (kind === 'party') return <PartyVisual />;
  if (kind === 'progression') return <ProgressionVisual />;
  if (kind === 'endgame') return <ProgressionVisual endgame />;
  return null;
}

function BeginnerGuide({ query, onPlay }: { query: string; onPlay: () => void }) {
  const needle = query.trim().toLowerCase();
  const filteredSteps = JOURNEY_STEPS.filter((step) => {
    if (!needle) return true;
    return [step.phase, step.title, step.intro, step.readyWhen, step.tip ?? '', ...step.learn, ...step.doNow]
      .join(' ').toLowerCase().includes(needle);
  });
  const filteredGlossary = GLOSSARY.filter(([term, description]) => !needle || `${term} ${description}`.toLowerCase().includes(needle));

  return <>
    <section className="wiki-beginner-hero">
      <div>
        <span>SE VOCÊ NUNCA JOGOU TIBIA, COMECE AQUI</span>
        <h2>Do primeiro personagem ao endgame</h2>
        <p>Este guia não pressupõe nenhum conhecimento. Siga os passos na ordem. Cada etapa explica <b>o que é</b>, <b>o que você deve fazer agora</b> e <b>como saber se já pode avançar</b>.</p>
        <div className="wiki-beginner-actions"><button onClick={onPlay}>Criar personagem / jogar</button><a href="#wiki-step-1">Começar o guia ↓</a></div>
      </div>
      <div className="wiki-beginner-scene">
        <CreatureIcon lookType={131} size={88} label="Aventureiro" />
        <span>→</span>
        <CreatureIcon monsterId={monsterIdByName('Rotworm')} size={88} label="Rotworm" />
        <span>→</span>
        <CreatureIcon monsterId={monsterIdByName('Demon')} size={96} label="Demon" />
      </div>
    </section>

    <section className="wiki-roadmap-intro">
      <h3>Seu caminho de evolução</h3>
      <div className="wiki-roadmap-line">
        {JOURNEY_STEPS.map((step) => <a href={`#wiki-step-${step.number}`} key={step.number}><b>{step.number}</b><span>{step.phase}</span></a>)}
      </div>
    </section>

    {filteredSteps.map((step) => <article className="wiki-journey-step" id={`wiki-step-${step.number}`} key={step.number}>
      <header>
        <div className="wiki-step-number">{step.number}</div>
        <div><span>{step.phase}</span><h3>{step.title}</h3><p>{step.intro}</p></div>
      </header>
      {step.visual && <StepVisual kind={step.visual} />}
      <div className="wiki-step-columns">
        <section><h4>Entenda isto</h4><ul>{step.learn.map((line) => <li key={line}>{line}</li>)}</ul></section>
        <section className="wiki-do-now"><h4>Faça agora</h4><ol>{step.doNow.map((line) => <li key={line}>{line}</li>)}</ol></section>
      </div>
      {step.tip && <p className="wiki-step-tip"><b>Dica:</b> {step.tip}</p>}
      <div className="wiki-ready"><span>✓</span><div><b>Você pode avançar quando:</b><p>{step.readyWhen}</p></div></div>
    </article>)}

    {!filteredSteps.length && <p className="wiki-empty-search">Nenhuma etapa do guia corresponde à sua busca.</p>}

    {!needle && <section className="wiki-help-card">
      <h3>Travou? Use esta regra simples</h3>
      <div className="wiki-help-grid">
        <article><b>Estou morrendo muito</b><p>Volte para uma hunt mais fácil, melhore equipamento, aumente segurança do Helper e confira supplies.</p></article>
        <article><b>Minha XP está baixa</b><p>Veja se a hunt ainda combina com seu nível, confira skills/magic level, equipamento, Prey e composição da party.</p></article>
        <article><b>Não consigo entrar na hunt</b><p>Confira nível mínimo do Principal, slots de party, custo, supplies, cooldown e disponibilidade da cave.</p></article>
        <article><b>Não sei o que melhorar</b><p>Escolha só um objetivo: sobreviver melhor, matar mais rápido ou aumentar lucro. Faça um upgrade que ataque esse problema.</p></article>
      </div>
    </section>}

    {filteredGlossary.length > 0 && <section className="wiki-glossary">
      <h3>Dicionário rápido para quem nunca jogou Tibia</h3>
      <p>Você verá estas palavras várias vezes no jogo. Não precisa decorar: volte aqui sempre que tiver dúvida.</p>
      <div>{filteredGlossary.map(([term, description]) => <article key={term}><b>{term}</b><span>{description}</span></article>)}</div>
    </section>}

    {!needle && <section className="wiki-final-path">
      <div><span>INÍCIO</span><MonsterExample name="Rotworm" caption="Aprender o básico" /></div>
      <b>→</b>
      <div><span>MIDGAME</span><MonsterExample name="Dragon" caption="Construir sua build" /></div>
      <b>→</b>
      <div><span>ALTO NÍVEL</span><MonsterExample name="Demon" caption="Otimizar o personagem" /></div>
      <b>→</b>
      <div><span>ENDGAME</span><MonsterExample name="Ferumbras" caption="Objetivos de longo prazo" /></div>
    </section>}
  </>;
}

export function WikiScreen({ onHome, onPlay }: { onHome: () => void; onPlay: () => void }) {
  const [section, setSection] = useState('Guia e tutorial');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const catalog = CATALOGS[section as keyof typeof CATALOGS];
  const entries = useMemo(() => {
    const all = catalog
      ? (Array.isArray(catalog) ? catalog : Object.values(catalog)) as unknown as Record<string, unknown>[]
      : [];
    return all.filter((entry) => String(entry.name ?? entry.id ?? section).toLowerCase().includes(query.toLowerCase()));
  }, [catalog, query, section]);

  return <main className="portal-page">
    <header className="portal-nav">
      <button onClick={onHome}>← Início</button>
      <strong>WIKI · KNOCK IDLE BR</strong>
      <button onClick={onPlay}>Jogar</button>
    </header>
    <div className="portal-content">
      <div className="portal-heading">
        <span>MANUAL DO AVENTUREIRO</span>
        <h1>Wiki do jogo</h1>
        <p>Se você nunca jogou Tibia, comece pelo guia. Quando já souber o básico, use os catálogos para consultar monstros, hunts, itens e sistemas específicos.</p>
      </div>

      <div className="wiki-layout">
        <aside className="wiki-sidebar">
          <button className={section === 'Guia e tutorial' ? 'on' : ''} onClick={() => { setSection('Guia e tutorial'); setQuery(''); setPage(0); }}>▶ Comece aqui</button>
          <div className="wiki-sidebar-label">CATÁLOGO</div>
          {Object.keys(CATALOGS).map((label) => <button className={section === label ? 'on' : ''} key={label} onClick={() => { setSection(label); setQuery(''); setPage(0); }}>{label}</button>)}
        </aside>

        <section className="wiki-main">
          <div className="wiki-section-head">
            <div><span>{section === 'Guia e tutorial' ? 'GUIA DO INICIANTE' : 'CATÁLOGO DO JOGO'}</span><h2>{section === 'Guia e tutorial' ? 'Comece aqui — do zero ao endgame' : section}</h2></div>
          </div>
          <input aria-label="Buscar na Wiki" placeholder={section === 'Guia e tutorial' ? 'Ex.: party, stamina, morrer, boss…' : 'Buscar nesta seção…'} value={query} onChange={(event) => { setQuery(event.target.value); setPage(0); }} />

          {section === 'Guia e tutorial'
            ? <BeginnerGuide query={query} onPlay={onPlay} />
            : <>
              <p>{entries.length.toLocaleString('pt-BR')} registros. Abra um registro para consultar atributos, requisitos e detalhes da base.</p>
              {entries.slice(page * 30, page * 30 + 30).map((entry, index) => {
                const monsterId = section === 'Monstros' && typeof entry.id === 'string' ? entry.id : undefined;
                return <details className="wiki-guide wiki-catalog-entry" key={String(entry.id ?? entry.name ?? index)}>
                  <summary>
                    {monsterId && <CreatureIcon monsterId={monsterId} size={42} label={String(entry.name ?? entry.id)} />}
                    <span>{String(entry.name ?? entry.id ?? 'Tabela de estágios')} {entry.level !== undefined && <small>· nível {String(entry.level)}</small>}</span>
                  </summary>
                  <DetailValue value={entry} />
                </details>;
              })}
              {!entries.length && <p>Nenhum registro encontrado.</p>}
              <div className="wiki-pagination">
                <button disabled={page === 0} onClick={() => setPage(page - 1)}>Anterior</button>
                <span>Página {page + 1} de {Math.max(1, Math.ceil(entries.length / 30))}</span>
                <button disabled={(page + 1) * 30 >= entries.length} onClick={() => setPage(page + 1)}>Próxima</button>
              </div>
            </>}
        </section>
      </div>

      <p className="portal-note">Guildas são um sistema social separado da party. Criar uma guild custa {GUILD_COST.toLocaleString('pt-BR')} gold.</p>
    </div>
  </main>;
}
