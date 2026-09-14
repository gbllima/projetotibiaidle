import { useEffect, useMemo, useState } from 'react';
import { getVocation, itemsById, type CombatType, type SkillName } from '@tibia-idle/data';
import {
  IMBUEMENTS,
  jewelrySpec,
  magicProgressPercent,
  skillProgressPercent,
} from '@tibia-idle/sim';
import type { CharacterView, EquippedItem } from '../api/types.js';
import { formatNumber, formatStamina, itemRarity } from '../format.js';
import { useLocale } from '../i18n/Locale.js';
import { outfitIconUrl } from '../render/outfitIcon.js';
import { PAPERDOLL_SLOTS } from '../ui/paperdollSlots.js';
import { ItemInspectModal } from './ItemInspectModal.js';
import { ItemSlot } from './ItemSlot.js';
import './BuildPanel.css';

const VOC_SHORT: Record<number, string> = {
  1: 'Sorcerer', 2: 'Druid', 3: 'Paladin', 4: 'Knight', 5: 'Master Sorcerer',
  6: 'Elder Druid', 7: 'Royal Paladin', 8: 'Elite Knight', 9: 'Monk', 10: 'Exalted Monk',
};

const ATTRIBUTE_TABS = [
  { id: 'geral', label: 'Geral', hint: 'Resumo do personagem' },
  { id: 'ataque', label: 'Ataque', hint: 'Dano, precisão e crítico' },
  { id: 'defesa', label: 'Defesa', hint: 'Proteções e sobrevivência' },
  { id: 'sustain', label: 'Sustentação', hint: 'Regeneração e leech' },
  { id: 'skills', label: 'Skills', hint: 'Treino e progresso' },
  { id: 'avancado', label: 'Avançado', hint: 'Forge e procs' },
] as const;

type AttributeTab = (typeof ATTRIBUTE_TABS)[number]['id'];

const SKILL_LABELS: Record<SkillName, string> = {
  fist: 'Fist Fighting',
  club: 'Club Fighting',
  sword: 'Sword Fighting',
  axe: 'Axe Fighting',
  distance: 'Distance Fighting',
  shield: 'Shielding',
  fishing: 'Fishing',
};

const DISPLAY_SKILLS: SkillName[] = ['fist', 'club', 'sword', 'axe', 'distance', 'shield', 'fishing'];

const RESISTANCES: Array<{
  label: string;
  icon: string;
  itemKey: string;
  combat: CombatType;
}> = [
  { label: 'Físico', icon: '⚔', itemKey: 'absorbpercentphysical', combat: 'COMBAT_PHYSICALDAMAGE' },
  { label: 'Fogo', icon: '🔥', itemKey: 'absorbpercentfire', combat: 'COMBAT_FIREDAMAGE' },
  { label: 'Gelo', icon: '❄', itemKey: 'absorbpercentice', combat: 'COMBAT_ICEDAMAGE' },
  { label: 'Terra', icon: '🌿', itemKey: 'absorbpercentearth', combat: 'COMBAT_EARTHDAMAGE' },
  { label: 'Energia', icon: '⚡', itemKey: 'absorbpercentenergy', combat: 'COMBAT_ENERGYDAMAGE' },
  { label: 'Holy', icon: '✦', itemKey: 'absorbpercentholy', combat: 'COMBAT_HOLYDAMAGE' },
  { label: 'Death', icon: '☠', itemKey: 'absorbpercentdeath', combat: 'COMBAT_DEATHDAMAGE' },
];

function proficiencyPercent(character: CharacterView): number {
  const skills = character.skills;
  const best = Math.max(
    10,
    skills.sword?.level ?? 10,
    skills.axe?.level ?? 10,
    skills.club?.level ?? 10,
    skills.distance?.level ?? 10,
    skills.fist?.level ?? 10,
    character.magicLevel ?? 0,
  );
  return Math.round(Math.min(10, Math.max(0, best - 10) * 0.2) * 10) / 10;
}

function itemBonus(character: CharacterView, key: string): number {
  return Object.values(character.equipment).reduce((sum, item) => (
    sum + (itemsById.get(item.id)?.bonuses[key] ?? 0)
  ), 0);
}

function activeImbue(character: CharacterView, id: string, now = Date.now()): CharacterView['imbuements'][number] | undefined {
  return character.imbuements.find((entry) => entry.type === id && entry.expiresAt > now);
}

function imbueReduction(character: CharacterView, combat: CombatType, now = Date.now()): number {
  let total = 0;
  for (const entry of character.imbuements) {
    if (entry.expiresAt <= now) continue;
    const spec = IMBUEMENTS.find((candidate) => candidate.id === entry.type);
    if (!spec || spec.kind !== 'reduction' || spec.combat !== combat) continue;
    total += spec.percent[entry.tier] ?? 0;
  }
  return total;
}

function protectionPercent(character: CharacterView, itemKey: string, combat: CombatType, now = Date.now()): number {
  let total = 0;
  for (const item of Object.values(character.equipment)) {
    const data = itemsById.get(item.id);
    total += data?.bonuses[itemKey] ?? 0;
    total += data?.bonuses.absorbpercentall ?? 0;
    total += jewelrySpec(item.id)?.absorb?.[combat] ?? 0;
  }
  total += imbueReduction(character, combat, now);
  return Math.max(0, Math.min(100, total));
}

function vibrancyChance(character: CharacterView, now = Date.now()): number {
  let best = 0;
  for (const entry of character.imbuements) {
    if (entry.expiresAt <= now) continue;
    const spec = IMBUEMENTS.find((candidate) => candidate.id === entry.type);
    if (!spec || spec.kind !== 'vibrancy') continue;
    best = Math.max(best, spec.chance[entry.tier] ?? 0);
  }
  return best;
}

function jewelryRegenPerSecond(character: CharacterView): { health: number; mana: number } {
  let health = 0;
  let mana = 0;
  for (const slot of ['ring', 'necklace'] as const) {
    const item = character.equipment[slot];
    const spec = item ? jewelrySpec(item.id) : null;
    health += (spec?.hpPerSix ?? 0) / 6;
    mana += (spec?.manaPerSix ?? 0) / 6;
  }
  return { health, mana };
}

function pct(value: number | undefined, digits = 1): string {
  if (!value) return '—';
  const fixed = Number(value.toFixed(digits));
  return `${fixed}%`;
}

function StatRow({
  label,
  value,
  active = true,
  detail,
}: {
  label: string;
  value: string;
  active?: boolean;
  detail?: string;
}) {
  return (
    <div className={`attr-stat-row ${active ? '' : 'muted'}`}>
      <span>
        {label}
        {detail && <small>{detail}</small>}
      </span>
      <strong>{value}</strong>
    </div>
  );
}

function Metric({ icon, label, value, note }: { icon: string; label: string; value: string; note?: string }) {
  return (
    <div className="attr-metric">
      <span className="attr-metric-icon" aria-hidden="true">{icon}</span>
      <div>
        <small>{label}</small>
        <strong>{value}</strong>
        {note && <em>{note}</em>}
      </div>
    </div>
  );
}

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="attr-card">
      <header>
        <h4>{title}</h4>
        {subtitle && <p>{subtitle}</p>}
      </header>
      <div className="attr-card-body">{children}</div>
    </section>
  );
}

function SkillBar({
  label,
  level,
  percent,
  primary = false,
}: {
  label: string;
  level: number;
  percent: number;
  primary?: boolean;
}) {
  const progress = Math.max(0, Math.min(100, percent));
  return (
    <div className={`attr-skill ${primary ? 'primary' : ''}`}>
      <div className="attr-skill-head">
        <div>
          <span>{label}</span>
          {primary && <small>skill principal</small>}
        </div>
        <strong>{level}</strong>
      </div>
      <div className="attr-skill-track"><i style={{ width: `${progress}%` }} /></div>
      <em>{progress.toFixed(1)}% para o próximo nível</em>
    </div>
  );
}

function BuildPortrait({ character }: { character: CharacterView }) {
  const [url, setUrl] = useState<string | null>(null);
  const voc = VOC_SHORT[character.vocation.id] ?? character.vocation.name;

  useEffect(() => {
    let alive = true;
    void outfitIconUrl(
      character.appearance.outfit,
      112,
      {
        head: character.appearance.head,
        body: character.appearance.body,
        legs: character.appearance.legs,
        feet: character.appearance.feet,
      },
      character.appearance.addons ?? 0,
      undefined,
      Boolean(character.appearance.mount),
    ).then((next) => {
      if (alive) setUrl(next);
    });
    return () => { alive = false; };
  }, [
    character.appearance.outfit,
    character.appearance.head,
    character.appearance.body,
    character.appearance.legs,
    character.appearance.feet,
    character.appearance.addons,
    character.appearance.mount,
  ]);

  return (
    <div className="build-portrait" title={character.name}>
      <div className="build-portrait-frame">
        {url ? <img src={url} alt="" /> : <span className="build-portrait-fallback">{voc.slice(0, 2)}</span>}
      </div>
      <span className="build-portrait-voc">{voc}</span>
    </div>
  );
}

export function BuildPanel({ character }: { character: CharacterView }) {
  const { t } = useLocale();
  const [inspectId, setInspectId] = useState<number | null>(null);
  const [tab, setTab] = useState<AttributeTab>('geral');

  const now = Date.now();
  const vocation = getVocation(character.vocation.id);
  const proficiency = proficiencyPercent(character);
  const worn = PAPERDOLL_SLOTS.filter((slot) => character.equipment[slot.id]).length;
  const tierCount = Object.values(character.equipmentTiers ?? {}).filter((tier) => tier > 0).length;
  const activeImbues = character.imbuements.filter((entry) => entry.expiresAt > now);
  const xpBoost = character.xpBoostUntil > now;
  const storeXp = character.storeBoosts.xp.until > now ? character.storeBoosts.xp.bonus : 0;
  const storeLoot = character.storeBoosts.loot.until > now ? character.storeBoosts.loot.bonus : 0;

  const attackSkill = character.stats.attackSkillName as SkillName;
  const hpPct = Math.round((character.health / Math.max(1, character.maxHealth)) * 100);
  const mpPct = Math.round((character.mana / Math.max(1, character.maxMana)) * 100);
  const attackSpeedSeconds = Math.max(0, vocation.attackSpeed) / 1000;
  const jewelryRegen = jewelryRegenPerSecond(character);
  const hpRegen = vocation.gainHpTicks > 0
    ? (vocation.gainHpAmount * 1000) / vocation.gainHpTicks + jewelryRegen.health
    : jewelryRegen.health;
  const manaRegen = vocation.gainManaTicks > 0
    ? (vocation.gainManaAmount * 1000) / vocation.gainManaTicks + jewelryRegen.mana
    : jewelryRegen.mana;
  const lifeLeechChance = Math.min(100,
    itemBonus(character, 'lifeleechchance') + (activeImbue(character, 'vampirism', now) ? 100 : 0));
  const manaLeechChance = Math.min(100,
    itemBonus(character, 'manaleechchance') + (activeImbue(character, 'void', now) ? 100 : 0));
  const currentCombo = character.live?.combo ?? 0;
  const comboBonus = Math.max(0, Math.min(20, currentCombo) - 1);
  const vibrancy = vibrancyChance(character, now);

  const resistances = useMemo(() => RESISTANCES.map((entry) => ({
    ...entry,
    value: protectionPercent(character, entry.itemKey, entry.combat, now),
  })), [character.equipment, character.imbuements, now]);

  const activeImbueRows = activeImbues.map((entry) => {
    const spec = IMBUEMENTS.find((candidate) => candidate.id === entry.type);
    return {
      id: `${entry.slot}:${entry.index ?? 0}:${entry.type}`,
      name: spec?.name ?? entry.type,
      tier: entry.tier + 1,
      slot: entry.slot,
      expiresAt: entry.expiresAt,
    };
  });

  return (
    <div className="build-panel attr-panel">
      <header className="build-hero attr-hero">
        <BuildPortrait character={character} />
        <div className="build-hero-main">
          <div className="build-hero-title">
            <span className="attr-kicker">ATRIBUTOS DO PERSONAGEM</span>
            <h3>{character.name}</h3>
            <p>Level {character.level} · {character.vocation.name}{character.promoted ? ' · Promovido' : ''}</p>
          </div>
          <div className="build-hero-badges">
            {character.premium && <span className="build-badge vip">VIP</span>}
            {proficiency > 0 && <span className="build-badge prof">+{proficiency}% prof.</span>}
            {character.partyBonus > 0 && <span className="build-badge party">Party +{character.partyBonus}%</span>}
            {xpBoost && <span className="build-badge boost">XP boost</span>}
          </div>
          <div className="build-hero-vitals">
            <div className="build-vital">
              <span>HP</span>
              <div className="meter hp"><i style={{ width: `${hpPct}%` }} /></div>
              <em>{formatNumber(character.health)}/{formatNumber(character.maxHealth)}</em>
            </div>
            <div className="build-vital">
              <span>MP</span>
              <div className="meter mana"><i style={{ width: `${mpPct}%` }} /></div>
              <em>{formatNumber(character.mana)}/{formatNumber(character.maxMana)}</em>
            </div>
          </div>
          <div className="build-hero-highlight">
            <div className="build-dps-block">
              <small>DPS estimado</small>
              <strong>{formatNumber(character.stats.damagePerSecond)}</strong>
            </div>
            <div className="build-dps-block">
              <small>Capacidade</small>
              <strong>{formatNumber(character.stats.capacity)}</strong>
            </div>
          </div>
        </div>
      </header>

      <nav className="attr-tabs" aria-label="Categorias de atributos">
        {ATTRIBUTE_TABS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            className={tab === entry.id ? 'on' : ''}
            onClick={() => setTab(entry.id)}
          >
            <strong>{entry.label}</strong>
            <small>{entry.hint}</small>
          </button>
        ))}
      </nav>

      <div className="attr-content">
        {tab === 'geral' && (
          <>
            <div className="attr-metrics-grid">
              <Metric icon="★" label="Level" value={String(character.level)} note={`${formatNumber(character.experience)} XP total`} />
              <Metric icon="🎒" label="Capacidade" value={formatNumber(character.stats.capacity)} note="carga máxima" />
              <Metric icon="⏱" label="Stamina" value={formatStamina(character.stamina)} note="tempo disponível" />
              <Metric icon="✦" label="Soul" value={`${character.soul}/${character.soulMax}`} note="recurso de vocação" />
            </div>

            <div className="attr-general-grid">
              <section className="build-set-card attr-equipment-card">
                <div className="build-set-head">
                  <div>
                    <h4>Equipamento</h4>
                    <p>Seu set atual influencia ataque, defesa, resistências e procs.</p>
                  </div>
                  <span>{worn}/10 slots</span>
                </div>
                <div className="paperdoll build-paperdoll">
                  {PAPERDOLL_SLOTS.map((slot) => {
                    const item = character.equipment[slot.id] as EquippedItem | undefined;
                    const tier = character.equipmentTiers?.[slot.id] ?? 0;
                    return (
                      <div key={slot.id} className={`paper-slot ${slot.area}`}>
                        <ItemSlot
                          itemId={item?.id}
                          label={item?.name}
                          emptyLabel={!item && slot.empty ? t(slot.empty) : undefined}
                          rarity={item ? itemRarity(item.id) : undefined}
                          onInspect={item ? setInspectId : undefined}
                          onClick={() => item && setInspectId(item.id)}
                        />
                        {tier > 0 && <span className="build-tier-badge">T{tier}</span>}
                      </div>
                    );
                  })}
                </div>
                <div className="build-set-meta">
                  {tierCount > 0 && <span>{tierCount} item(ns) exaltado(s)</span>}
                  {activeImbues.length > 0 && <span>{activeImbues.length} imbuement(s) ativo(s)</span>}
                  {character.blessings > 0 && <span>{character.blessings} blessing(s)</span>}
                </div>
              </section>

              <Section title="Resumo de combate" subtitle="Os números mais importantes para saber se seu personagem está pronto para uma hunt.">
                <StatRow label="Ataque" value={String(character.stats.attackValue)} detail="valor da arma" />
                <StatRow label="Skill principal" value={`${character.stats.attackSkill}`} detail={SKILL_LABELS[attackSkill] ?? attackSkill} />
                <StatRow label="Defesa" value={String(character.stats.defense)} />
                <StatRow label="Armadura" value={String(character.stats.armor)} />
                <StatRow label="Mitigation" value={character.stats.mitigation.toFixed(2)} />
                <StatRow label="Crítico" value={pct(character.procs?.critChance)} active={Boolean(character.procs?.critChance)} />
              </Section>
            </div>

            <Section title="Boosts ativos" subtitle="Bônus gerais aplicados ao personagem neste momento.">
              <div className="attr-chip-grid">
                <span className={character.boosts.xp > 0 || storeXp > 0 ? 'on' : ''}>XP +{character.boosts.xp + storeXp}%</span>
                <span className={character.boosts.damage > 0 ? 'on' : ''}>Dano +{character.boosts.damage}%</span>
                <span className={character.boosts.loot > 0 || storeLoot > 0 ? 'on' : ''}>Loot +{character.boosts.loot + storeLoot}%</span>
                <span className={character.boosts.defense > 0 ? 'on' : ''}>Defesa +{character.boosts.defense}%</span>
                <span className={proficiency > 0 ? 'on' : ''}>Proficiência +{proficiency}%</span>
                <span className={character.partyBonus > 0 ? 'on' : ''}>Party +{character.partyBonus}% XP</span>
              </div>
            </Section>
          </>
        )}

        {tab === 'ataque' && (
          <div className="attr-two-col">
            <Section title="Ataque principal" subtitle="Valores usados para transformar seu equipamento e skill em dano.">
              <StatRow label="Attack Value" value={String(character.stats.attackValue)} detail="poder base da arma" />
              <StatRow label="Attack Skill" value={String(character.stats.attackSkill)} detail={SKILL_LABELS[attackSkill] ?? attackSkill} />
              <StatRow label="DPS estimado" value={formatNumber(character.stats.damagePerSecond)} />
              <StatRow label="Attack Speed" value={`${attackSpeedSeconds.toFixed(2)}s`} detail="intervalo base entre ataques" />
              {character.procs?.hitChance !== undefined && (
                <StatRow label="Hit Chance" value={`${character.procs.hitChance}%`} detail="armas à distância" />
              )}
              <StatRow label="Magic Level efetivo" value={String(character.procs?.magicLevel ?? character.magicLevel)} />
            </Section>

            <Section title="Crítico e explosão" subtitle="Procs que aumentam o dano de forma instantânea.">
              <StatRow label="Critical Chance" value={pct(character.procs?.critChance)} active={Boolean(character.procs?.critChance)} />
              <StatRow label="Critical Extra Damage" value={character.procs?.critExtra ? `+${character.procs.critExtra}%` : '—'} active={Boolean(character.procs?.critExtra)} />
              <StatRow label="Fatal / Onslaught" value={pct(character.procs?.onslaughtChance)} active={Boolean(character.procs?.onslaughtChance)} detail="golpe da Forge" />
              <StatRow label="Combo atual" value={currentCombo > 0 ? `${currentCombo} hits` : '—'} active={currentCombo > 0} />
              <StatRow label="Bônus do combo" value={comboBonus > 0 ? `+${comboBonus}% dano` : '—'} active={comboBonus > 0} detail="até 20 hits" />
              <StatRow label="Proficiência" value={proficiency > 0 ? `+${proficiency}% dano` : '—'} active={proficiency > 0} />
            </Section>

            <Section title="Como evoluir o dano" subtitle="A ordem abaixo ajuda um jogador novo a entender de onde o dano vem.">
              <ol className="attr-guide-list">
                <li><strong>1.</strong><span>Treine <b>{SKILL_LABELS[attackSkill] ?? attackSkill}</b> ou Magic Level.</span></li>
                <li><strong>2.</strong><span>Equipe uma arma com Attack maior e adequada à sua vocação.</span></li>
                <li><strong>3.</strong><span>Use Strike para ganhar Critical Chance e Critical Damage.</span></li>
                <li><strong>4.</strong><span>No endgame, aumente o tier da arma para liberar Onslaught.</span></li>
              </ol>
            </Section>
          </div>
        )}

        {tab === 'defesa' && (
          <div className="attr-two-col">
            <Section title="Defesa base" subtitle="Os três números que reduzem ou evitam dano antes das resistências elementais.">
              <StatRow label="Defense" value={String(character.stats.defense)} detail="shield + skill + arma" />
              <StatRow label="Armor" value={String(character.stats.armor)} detail="soma das peças equipadas" />
              <StatRow label="Mitigation" value={character.stats.mitigation.toFixed(2)} detail="redução calculada pelo servidor" />
              <StatRow label="Dodge / Ruse" value={pct(character.procs?.dodgeChance)} active={Boolean(character.procs?.dodgeChance)} detail="chance de evitar o golpe" />
              <StatRow label="Magic Shield" value={character.policy.magicShield ? 'Ativado no Helper' : 'Desativado'} active={character.policy.magicShield} detail="dano pode consumir mana" />
            </Section>

            <Section title="Proteções elementais" subtitle="Soma do equipamento, Protection All, joias e imbuements ativos.">
              <div className="attr-resistance-grid">
                {resistances.map((entry) => (
                  <div key={entry.combat} className={entry.value > 0 ? 'active' : ''}>
                    <span>{entry.icon}</span>
                    <small>{entry.label}</small>
                    <strong>{entry.value}%</strong>
                  </div>
                ))}
              </div>
            </Section>

            <Section title="Leitura rápida" subtitle="Use as resistências para escolher o set certo para cada cave.">
              <div className="attr-tip">
                <strong>Exemplo:</strong>
                <p>Se a hunt causa muito fogo, aumentar <b>Proteção de Fogo</b> pode valer mais do que simplesmente colocar uma peça com Armor maior.</p>
              </div>
            </Section>
          </div>
        )}

        {tab === 'sustain' && (
          <div className="attr-two-col">
            <Section title="Regeneração" subtitle="Regeneração passiva base da vocação + joias equipadas. Food é temporário e não entra neste valor.">
              <StatRow label="HP Regen" value={`${hpRegen.toFixed(2)} HP/s`} />
              <StatRow label="Mana Regen" value={`${manaRegen.toFixed(2)} MP/s`} />
              <StatRow label="HP atual" value={`${formatNumber(character.health)} / ${formatNumber(character.maxHealth)}`} />
              <StatRow label="Mana atual" value={`${formatNumber(character.mana)} / ${formatNumber(character.maxMana)}`} />
            </Section>

            <Section title="Life Leech" subtitle="Recupera HP a partir do dano causado.">
              <StatRow label="Chance de ativação" value={lifeLeechChance > 0 ? `${lifeLeechChance}%` : '—'} active={lifeLeechChance > 0} />
              <StatRow label="Quantidade" value={pct(character.procs?.lifeLeech)} active={Boolean(character.procs?.lifeLeech)} detail="percentual do dano convertido em HP" />
              <StatRow label="Vampirism" value={activeImbue(character, 'vampirism', now) ? 'Ativo' : 'Não equipado'} active={Boolean(activeImbue(character, 'vampirism', now))} />
            </Section>

            <Section title="Mana Leech" subtitle="Recupera mana a partir do dano causado.">
              <StatRow label="Chance de ativação" value={manaLeechChance > 0 ? `${manaLeechChance}%` : '—'} active={manaLeechChance > 0} />
              <StatRow label="Quantidade" value={pct(character.procs?.manaLeech)} active={Boolean(character.procs?.manaLeech)} detail="percentual do dano convertido em mana" />
              <StatRow label="Void" value={activeImbue(character, 'void', now) ? 'Ativo' : 'Não equipado'} active={Boolean(activeImbue(character, 'void', now))} />
            </Section>

            <Section title="Por que isso importa?" subtitle="Sustentação determina por quanto tempo você consegue permanecer numa hunt.">
              <div className="attr-tip">
                <p>Mais leech e regeneração normalmente significam <b>menos poções gastas</b>, maior segurança e mais lucro por hora.</p>
              </div>
            </Section>
          </div>
        )}

        {tab === 'skills' && (
          <div className="attr-skills-layout">
            <Section title="Skills físicas" subtitle="Cada barra mostra o progresso real de tries até o próximo nível.">
              <div className="attr-skills-grid">
                {DISPLAY_SKILLS.map((skill) => {
                  const state = character.skills[skill] ?? { level: 10, tries: 0 };
                  return (
                    <SkillBar
                      key={skill}
                      label={SKILL_LABELS[skill]}
                      level={state.level}
                      percent={skillProgressPercent(character.vocation.id, skill, state.level, state.tries)}
                      primary={skill === attackSkill}
                    />
                  );
                })}
              </div>
            </Section>

            <Section title="Magic Level" subtitle="Evolui através da mana gasta e é essencial para magias, runas e cura.">
              <SkillBar
                label="Magic Level"
                level={character.magicLevel}
                percent={magicProgressPercent(character.vocation.id, character.magicLevel, character.manaSpent)}
                primary={Boolean([1, 2, 5, 6].includes(character.vocation.id))}
              />
              <div className="attr-tip compact">
                <p>ML efetivo com equipamentos e imbuements: <b>{character.procs?.magicLevel ?? character.magicLevel}</b></p>
              </div>
            </Section>
          </div>
        )}

        {tab === 'avancado' && (
          <div className="attr-two-col">
            <Section title="Exaltation Forge" subtitle="Procs avançados liberados pelos tiers do equipamento.">
              <StatRow label="Ruse" value={pct(character.procs?.dodgeChance)} active={Boolean(character.procs?.dodgeChance)} detail="armor · chance de dodge" />
              <StatRow label="Onslaught" value={pct(character.procs?.onslaughtChance)} active={Boolean(character.procs?.onslaughtChance)} detail="arma · chance de Fatal" />
              <StatRow label="Momentum" value={pct(character.procs?.momentumChance)} active={Boolean(character.procs?.momentumChance)} detail="helmet · reseta cooldown" />
              <StatRow label="Transcendence" value={pct(character.procs?.transcendenceChance, 2)} active={Boolean(character.procs?.transcendenceChance)} detail="legs · ativa Avatar" />
              <StatRow label="Amplification" value={character.procs?.amplificationPercent ? `+${character.procs.amplificationPercent}%` : '—'} active={Boolean(character.procs?.amplificationPercent)} detail="boots · amplifica procs" />
            </Section>

            <Section title="Controle e utilidade" subtitle="Efeitos que não aparecem como Attack ou Defense, mas mudam a luta.">
              <StatRow label="Vibrancy" value={vibrancy > 0 ? `${vibrancy}%` : '—'} active={vibrancy > 0} detail="chance de resistir a paralyze" />
              <StatRow label="Soul" value={`${character.soul}/${character.soulMax}`} detail="usado por sistemas de vocação" />
              {character.harmony !== undefined && (
                <StatRow label="Harmony" value={`${character.harmony}/5`} active={character.harmony > 0} detail="recurso do Monk" />
              )}
              <StatRow label="Blessings" value={String(character.blessings)} active={character.blessings > 0} />
              <StatRow label="Forge Dust" value={formatNumber(character.forgeDust)} active={character.forgeDust > 0} />
            </Section>

            <Section title="Imbuements ativos" subtitle="Bônus temporários de 20 horas que estão contribuindo para os atributos acima.">
              {activeImbueRows.length > 0 ? (
                <div className="attr-imbue-list">
                  {activeImbueRows.map((entry) => (
                    <div key={entry.id}>
                      <span><strong>{entry.name}</strong><small>{entry.slot} · Tier {entry.tier}</small></span>
                      <em>{Math.max(0, Math.ceil((entry.expiresAt - now) / 3_600_000))}h</em>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="attr-empty">Nenhum imbuement ativo.</p>
              )}
            </Section>

            <Section title="Avatar da Forge" subtitle="Transcendence ativa temporariamente um estado de alto poder.">
              <div className="attr-avatar-box">
                <span>Durante o Avatar:</span>
                <strong>100% Critical Chance</strong>
                <strong>+15% Critical Extra Damage</strong>
                <strong>15% menos dano recebido</strong>
              </div>
            </Section>
          </div>
        )}
      </div>

      {inspectId !== null && (
        <ItemInspectModal itemId={inspectId} onClose={() => setInspectId(null)} />
      )}
    </div>
  );
}
