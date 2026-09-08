import { useEffect, useMemo, useState } from 'react';
import type { SkillName } from '@tibia-idle/data';
import { magicProgressPercent, skillProgressPercent } from '@tibia-idle/sim';
import type { CharacterView, EquippedItem } from '../api/types.js';
import { formatNumber, itemRarity } from '../format.js';
import { useLocale } from '../i18n/Locale.js';
import { outfitIconUrl } from '../render/outfitIcon.js';
import { PAPERDOLL_SLOTS } from '../ui/paperdollSlots.js';
import { ItemInspectModal } from './ItemInspectModal.js';
import { ItemSlot } from './ItemSlot.js';

const VOC_SHORT: Record<number, string> = {
  1: 'Sorcerer', 2: 'Druid', 3: 'Paladin', 4: 'Knight', 5: 'Master Sorcerer',
  6: 'Elder Druid', 7: 'Royal Paladin', 8: 'Elite Knight', 9: 'Monk', 10: 'Exalted Monk',
};

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

function StatRow({
  label,
  value,
  active = true,
  accent,
}: {
  label: string;
  value: string;
  active?: boolean;
  accent?: 'profit' | 'off';
}) {
  return (
    <div className={`build-stat-row ${active ? '' : 'muted'}`}>
      <span>{label}</span>
      <strong className={accent ?? (active ? undefined : 'off')}>{value}</strong>
    </div>
  );
}

function SkillBar({
  label,
  level,
  percent,
}: {
  label: string;
  level: number;
  percent: number;
}) {
  return (
    <div className="build-skill-bar">
      <div className="build-skill-bar-head">
        <span>{label}</span>
        <strong>{level}</strong>
      </div>
      <div className="build-skill-bar-track">
        <i style={{ width: `${Math.max(0, Math.min(100, percent))}%` }} />
      </div>
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

  const proficiency = proficiencyPercent(character);
  const worn = PAPERDOLL_SLOTS.filter((slot) => character.equipment[slot.id]).length;
  const tierCount = Object.values(character.equipmentTiers ?? {}).filter((tier) => tier > 0).length;
  const imbueActive = character.imbuements.filter((entry) => entry.expiresAt > Date.now()).length;
  const now = Date.now();
  const xpBoost = character.xpBoostUntil > now;
  const storeXp = character.storeBoosts.xp.until > now ? character.storeBoosts.xp.bonus : 0;
  const storeLoot = character.storeBoosts.loot.until > now ? character.storeBoosts.loot.bonus : 0;

  const attackSkill = character.stats.attackSkillName as SkillName;
  const attackSkillLevel = character.skills[attackSkill]?.level ?? character.stats.attackSkill;
  const attackSkillTries = character.skills[attackSkill]?.tries ?? 0;
  const shieldLevel = character.skills.shield?.level ?? 10;
  const shieldTries = character.skills.shield?.tries ?? 0;

  const procRows = useMemo(() => [
    {
      label: 'Crítico',
      value: character.procs?.critChance
        ? `${character.procs.critChance}% · +${character.procs.critExtra}%`
        : '—',
      active: Boolean(character.procs?.critChance),
    },
    ...(character.procs?.hitChance !== undefined ? [{
      label: 'Precisão',
      value: `${character.procs.hitChance}%`,
      active: character.procs.hitChance >= 90,
    }] : []),
    { label: 'Life leech', value: character.procs?.lifeLeech ? `${character.procs.lifeLeech}%` : '—', active: Boolean(character.procs?.lifeLeech) },
    { label: 'Mana leech', value: character.procs?.manaLeech ? `${character.procs.manaLeech}%` : '—', active: Boolean(character.procs?.manaLeech) },
    { label: 'Dodge (Ruse)', value: character.procs?.dodgeChance ? `${character.procs.dodgeChance}%` : '—', active: Boolean(character.procs?.dodgeChance) },
    { label: 'Onslaught', value: character.procs?.onslaughtChance ? `${character.procs.onslaughtChance}%` : '—', active: Boolean(character.procs?.onslaughtChance) },
    { label: 'Momentum', value: character.procs?.momentumChance ? `${character.procs.momentumChance}%` : '—', active: Boolean(character.procs?.momentumChance) },
    { label: 'Transcendence', value: character.procs?.transcendenceChance ? `${character.procs.transcendenceChance}%` : '—', active: Boolean(character.procs?.transcendenceChance) },
    { label: 'Amplification', value: character.procs?.amplificationPercent ? `+${character.procs.amplificationPercent}%` : '—', active: Boolean(character.procs?.amplificationPercent) },
  ], [character.procs]);

  const hpPct = Math.round((character.health / Math.max(1, character.maxHealth)) * 100);
  const mpPct = Math.round((character.mana / Math.max(1, character.maxMana)) * 100);

  return (
    <div className="build-panel">
      <header className="build-hero">
        <BuildPortrait character={character} />
        <div className="build-hero-main">
          <div className="build-hero-title">
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
              <em>{character.health}/{character.maxHealth}</em>
            </div>
            <div className="build-vital">
              <span>MP</span>
              <div className="meter mana"><i style={{ width: `${mpPct}%` }} /></div>
              <em>{character.mana}/{character.maxMana}</em>
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

      <div className="build-body">
        <section className="build-set-card">
          <div className="build-set-head">
            <h4>Equipamento</h4>
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
            {imbueActive > 0 && <span>{imbueActive} imbuement(s) ativo(s)</span>}
            {character.blessings > 0 && <span>{character.blessings} blessing(s)</span>}
          </div>
        </section>

        <div className="build-stats-grid">
          <section className="build-stat-card">
            <h4>Combate</h4>
            <StatRow
              label="Ataque"
              value={`${character.stats.attackValue} · ${character.stats.attackSkillName} ${character.stats.attackSkill}`}
            />
            <StatRow label="Defesa" value={String(character.stats.defense)} />
            <StatRow label="Armadura" value={String(character.stats.armor)} />
            <StatRow label="Mitigation" value={character.stats.mitigation.toFixed(2)} />
            <StatRow
              label="Proficiência"
              value={proficiency ? `+${proficiency}% dano` : '—'}
              active={proficiency > 0}
              accent={proficiency ? 'profit' : 'off'}
            />
          </section>

          <section className="build-stat-card">
            <h4>Procs &amp; Leech</h4>
            {procRows.map((row) => (
              <StatRow
                key={row.label}
                label={row.label}
                value={row.value}
                active={row.active}
                accent={row.active ? 'profit' : 'off'}
              />
            ))}
            <StatRow
              label="ML efetivo"
              value={String(character.procs?.magicLevel ?? character.magicLevel)}
            />
          </section>

          <section className="build-stat-card build-stat-card-wide">
            <h4>Skills &amp; Boosts</h4>
            <div className="build-skills">
              <SkillBar
                label={attackSkill}
                level={attackSkillLevel}
                percent={skillProgressPercent(character.vocation.id, attackSkill, attackSkillLevel, attackSkillTries)}
              />
              <SkillBar
                label="shield"
                level={shieldLevel}
                percent={skillProgressPercent(character.vocation.id, 'shield', shieldLevel, shieldTries)}
              />
              <SkillBar
                label="magic level"
                level={character.magicLevel}
                percent={magicProgressPercent(character.vocation.id, character.magicLevel, character.manaSpent)}
              />
            </div>
            <div className="build-boosts">
              <span className={character.boosts.xp > 0 || storeXp > 0 ? 'on xp' : ''}>
                XP {character.boosts.xp + storeXp}%
              </span>
              <span className={character.boosts.damage > 0 ? 'on dmg' : ''}>
                Dmg {character.boosts.damage}%
              </span>
              <span className={character.boosts.loot > 0 || storeLoot > 0 ? 'on loot' : ''}>
                Loot {character.boosts.loot + storeLoot}%
              </span>
              <span className={character.boosts.defense > 0 ? 'on def' : ''}>
                Def {character.boosts.defense}%
              </span>
            </div>
          </section>
        </div>
      </div>

      {inspectId !== null && (
        <ItemInspectModal itemId={inspectId} onClose={() => setInspectId(null)} />
      )}
    </div>
  );
}
