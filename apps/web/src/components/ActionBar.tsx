import { useEffect, useMemo, useState } from 'react';
import { SPELLS, runesFor, spellsFor, type Spell } from '@tibia-idle/sim';
import type { CharacterView } from '../api/types.js';
import { api } from '../api/client.js';
import { outfitIconUrl } from '../render/outfitIcon.js';
import { SpellIcon } from './SpellIcon.js';
import { ItemSlot } from './ItemSlot.js';

const VOC_SHORT: Record<number, string> = {
  1: 'MS', 2: 'ED', 3: 'RP', 4: 'EK', 5: 'MS', 6: 'ED', 7: 'RP', 8: 'EK', 9: 'MK', 10: 'MK',
};

const BAR_SLOTS = 4;

type MiniPolicy = {
  spellPriority: string[];
  disabledSpells: string[];
  runeId?: number;
};

type BarMember = {
  id: number;
  name: string;
  vocationId: number;
  level: number;
  appearance?: CharacterView['appearance'];
  policy: MiniPolicy;
  full?: CharacterView;
};

type RotationTarget = BarMember & { slot: number };
type RotationTab = 'all' | 'attack' | 'area' | 'runes';

export function spellAccentClass(damageType: string): string {
  if (damageType.includes('FIRE')) return 'spell-fire';
  if (damageType.includes('ICE')) return 'spell-ice';
  if (damageType.includes('ENERGY')) return 'spell-energy';
  if (damageType.includes('EARTH')) return 'spell-earth';
  if (damageType.includes('DEATH')) return 'spell-death';
  if (damageType.includes('HOLY')) return 'spell-holy';
  return 'spell-physical';
}

export function spellShortLabel(spell: Spell): string {
  const word = spell.words.split(' ').pop() ?? spell.name;
  return word.length > 5 ? word.slice(0, 5) : word;
}

function PortraitImage({ appearance, vocationId }: { appearance?: CharacterView['appearance']; vocationId: number }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    if (!appearance) {
      setUrl(null);
      return () => { alive = false; };
    }
    void outfitIconUrl(appearance.outfit, 42, {
      head: appearance.head,
      body: appearance.body,
      legs: appearance.legs,
      feet: appearance.feet,
    }, appearance.addons ?? 0).then((next) => {
      if (alive) setUrl(next);
    });
    return () => { alive = false; };
  }, [appearance]);
  return url ? <img src={url} alt="" /> : <span className="action-bar__portrait-fallback">{VOC_SHORT[vocationId] ?? '?'}</span>;
}

function configuredSpells(member: BarMember): Array<Spell | null> {
  const disabled = new Set(member.policy.disabledSpells ?? []);
  const available = spellsFor(member.vocationId, member.level);
  const byId = new Map(available.map((spell) => [spell.id, spell]));
  const chosen: Spell[] = [];
  for (const id of member.policy.spellPriority ?? []) {
    const spell = byId.get(id);
    if (!spell || disabled.has(id) || chosen.some((entry) => entry.id === id)) continue;
    chosen.push(spell);
    if (chosen.length >= BAR_SLOTS) break;
  }
  if (chosen.length === 0) {
    for (const spell of available) {
      if (disabled.has(spell.id)) continue;
      chosen.push(spell);
      if (chosen.length >= BAR_SLOTS) break;
    }
  }
  return Array.from({ length: BAR_SLOTS }, (_, index) => chosen[index] ?? null);
}

function policyForRotation(member: BarMember): MiniPolicy {
  if (member.policy.spellPriority.length > 0) return member.policy;
  return {
    ...member.policy,
    spellPriority: configuredSpells(member).flatMap((spell) => spell ? [spell.id] : []),
  };
}

function RotationModal({ target, onClose, onSaved, onOpenHelper }: {
  target: RotationTarget;
  onClose: () => void;
  onSaved: (characterId: number, policy: MiniPolicy) => void;
  onOpenHelper: (characterId: number) => void;
}) {
  const [tab, setTab] = useState<RotationTab>('all');
  const [search, setSearch] = useState('');
  const [onlyUnlocked, setOnlyUnlocked] = useState(true);
  const [loading, setLoading] = useState(false);
  const [full, setFull] = useState<CharacterView | null>(target.full ?? null);
  const [policy, setPolicy] = useState<MiniPolicy>({
    spellPriority: [...target.policy.spellPriority],
    disabledSpells: [...target.policy.disabledSpells],
    runeId: target.policy.runeId,
  });

  useEffect(() => {
    let alive = true;
    if (target.full) {
      setFull(target.full);
      return () => { alive = false; };
    }
    void api.character(target.id).then((result) => {
      if (!alive) return;
      setFull(result.character);
      const serverPriority = result.character.policy.spellPriority.length > 0
        ? result.character.policy.spellPriority
        : target.policy.spellPriority;
      setPolicy({
        spellPriority: [...serverPriority],
        disabledSpells: [...result.character.policy.disabledSpells],
        runeId: result.character.policy.runeId,
      });
    }).catch(() => undefined);
    return () => { alive = false; };
  }, [target.id]);

  const allClassSpells = useMemo(
    () => SPELLS.filter((spell) => spell.vocations.includes(target.vocationId))
      .sort((a, b) => a.level - b.level || a.name.localeCompare(b.name)),
    [target.vocationId],
  );

  const filteredSpells = allClassSpells.filter((spell) => {
    if (onlyUnlocked && spell.level > target.level) return false;
    if (tab === 'attack' && spell.area) return false;
    if (tab === 'area' && !spell.area) return false;
    const q = search.trim().toLocaleLowerCase('pt-BR');
    return !q || spell.name.toLocaleLowerCase('pt-BR').includes(q) || spell.words.toLocaleLowerCase('pt-BR').includes(q);
  });

  const runes = full ? runesFor(full.vocation.id, full.level, full.magicLevel) : [];
  const currentId = policy.spellPriority[target.slot];

  async function persist(next: MiniPolicy) {
    setPolicy(next);
    onSaved(target.id, next);
    setLoading(true);
    try {
      const result = await api.act(target.id, {
        type: 'policy',
        spellPriority: next.spellPriority,
        disabledSpells: next.disabledSpells,
        ...(next.runeId !== undefined ? { runeId: next.runeId } : {}),
      });
      setFull(result.character);
      const confirmed: MiniPolicy = {
        spellPriority: [...result.character.policy.spellPriority],
        disabledSpells: [...result.character.policy.disabledSpells],
        runeId: result.character.policy.runeId,
      };
      setPolicy(confirmed);
      onSaved(target.id, confirmed);
    } finally {
      setLoading(false);
    }
  }

  function chooseSpell(spell: Spell) {
    const without = policy.spellPriority.filter((id) => id !== spell.id);
    const nextPriority = [...without];
    const insertAt = Math.min(target.slot, nextPriority.length);
    nextPriority.splice(insertAt, 0, spell.id);
    void persist({
      ...policy,
      spellPriority: nextPriority,
      disabledSpells: policy.disabledSpells.filter((id) => id !== spell.id),
    });
  }

  function clearSlot() {
    if (!currentId) return;
    void persist({ ...policy, spellPriority: policy.spellPriority.filter((id) => id !== currentId) });
  }

  return (
    <div className="modal rotation-modal" onClick={onClose}>
      <section className="rotation-card" onClick={(event) => event.stopPropagation()}>
        <header className="rotation-head">
          <div>
            <span>ROTAÇÃO</span>
            <strong>{target.name} · slot {target.slot + 1} <small>(ordem = prioridade)</small></strong>
          </div>
          <button type="button" onClick={onClose}>×</button>
        </header>

        <div className="rotation-tabs">
          {([['all', 'Todas'], ['attack', 'Ataque'], ['area', 'Área'], ['runes', 'Runas']] as const).map(([id, label]) => (
            <button key={id} type="button" className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>{label}</button>
          ))}
        </div>

        <div className="rotation-tools">
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por nome ou palavra (ex.: exura, fireball)…" />
          <label><input type="checkbox" checked={onlyUnlocked} onChange={(event) => setOnlyUnlocked(event.target.checked)} /> Só liberadas</label>
        </div>

        <div className="rotation-list">
          {tab !== 'runes' && filteredSpells.map((spell) => {
            const selected = currentId === spell.id;
            const disabled = policy.disabledSpells.includes(spell.id);
            const unlocked = spell.level <= target.level;
            const rank = policy.spellPriority.indexOf(spell.id);
            return (
              <article key={spell.id} className={`rotation-entry ${selected ? 'selected' : ''} ${disabled ? 'disabled' : ''}`}>
                <SpellIcon spell={spell} size={48} />
                <div className="rotation-entry-copy">
                  <strong>{spell.name}</strong>
                  <b>{spell.words}</b>
                  <small>lvl {spell.level} · {spell.mana} mana · cd {Math.max(1, Math.round(spell.cooldown / 1000))}s · {spell.area ? 'Área' : 'Alvo'}</small>
                </div>
                <div className="rotation-entry-state">
                  {rank >= 0 && <span>#{rank + 1}</span>}
                  <button type="button" disabled={loading || !unlocked} onClick={() => chooseSpell(spell)}>{selected ? 'Em uso' : unlocked ? 'Usar' : `Lvl ${spell.level}`}</button>
                </div>
              </article>
            );
          })}

          {tab === 'runes' && (
            <>
              {runes.length === 0 && <p className="rotation-empty">Nenhuma runa liberada para este personagem.</p>}
              {runes.map((rune) => {
                const selected = (policy.runeId ?? -1) === rune.itemId;
                return (
                  <article key={rune.itemId} className={`rotation-entry ${selected ? 'selected' : ''}`}>
                    <ItemSlot itemId={rune.itemId} label={rune.name} />
                    <div className="rotation-entry-copy">
                      <strong>{rune.name}</strong>
                      <b>Runa de ataque</b>
                      <small>lvl {rune.level} · magic level {rune.magicLevel}</small>
                    </div>
                    <div className="rotation-entry-state">
                      <button type="button" disabled={loading} onClick={() => void persist({ ...policy, runeId: selected ? -1 : rune.itemId })}>{selected ? 'Em uso' : 'Usar'}</button>
                    </div>
                  </article>
                );
              })}
              <button className="rotation-helper-link" type="button" onClick={() => { onClose(); onOpenHelper(target.id); }}>Mais opções de runas no Helper → Táticas</button>
            </>
          )}
        </div>

        <footer className="rotation-foot">
          <span>Slot {target.slot + 1}: {currentId ? allClassSpells.find((spell) => spell.id === currentId)?.name ?? currentId : 'vazio'}</span>
          <div>
            <button type="button" disabled={!currentId || loading} onClick={clearSlot}>Limpar slot</button>
            <button type="button" onClick={onClose}>Fechar</button>
          </div>
        </footer>
      </section>
    </div>
  );
}

export function ActionBar(props: {
  character: CharacterView;
  spells: Spell[];
  onAutoAttack: (characterId: number) => void;
  onSpellPriority: (characterId: number, spell: Spell) => void;
  onSpellToggle: (characterId: number, spell: Spell, disabled: boolean) => void;
  onOpenSpells: () => void;
  hint: string;
  spellsConfigLabel: string;
  onOpenHelper: (characterId: number) => void;
}) {
  const { character } = props;
  const [rotation, setRotation] = useState<RotationTarget | null>(null);
  const [overrides, setOverrides] = useState<Record<number, MiniPolicy>>({});

  useEffect(() => {
    setOverrides({});
    setRotation(null);
  }, [character.id]);

  // Only characters owned by this account belong on the controllable action
  // bar. Multiplayer allies are visible in the Party panel and hunt scene, but
  // their rotations/Helper remain controlled by their own player.
  const controllableIds = new Set(character.partyMemberIds ?? [character.id]);
  const members: BarMember[] = [
    {
      id: character.id,
      name: character.name,
      vocationId: character.vocation.id,
      level: character.level,
      appearance: character.appearance,
      policy: overrides[character.id] ?? character.policy,
      full: character,
    },
    ...(character.caveParty ?? [])
      .filter((member) => !member.self && controllableIds.has(member.id))
      .map((member) => ({
        id: member.id,
        name: member.name,
        vocationId: member.vocationId,
        level: member.level,
        appearance: member.appearance as CharacterView['appearance'] | undefined,
        policy: overrides[member.id] ?? {
          spellPriority: member.policy?.spellPriority ?? [],
          disabledSpells: member.policy?.disabledSpells ?? [],
        },
      })),
  ];

  return (
    <>
      <div className="action-bar action-bar--compact">
        <div className="action-bar__panel">
          {members.map((member) => {
            const slots = configuredSpells(member);
            return (
              <div className="action-bar__character-group" key={member.id}>
                <button type="button" className="action-bar__portrait-button" title={`${member.name} — abrir Helper`} onClick={() => props.onOpenHelper(member.id)}>
                  <span className="action-bar__portrait">
                    <PortraitImage appearance={member.appearance} vocationId={member.vocationId} />
                    <span className="action-bar__portrait-tag">{VOC_SHORT[member.vocationId] ?? '?'}</span>
                  </span>
                </button>
                {slots.map((spell, slot) => (
                  <button
                    type="button"
                    key={`${member.id}-slot-${slot}`}
                    className={`action-bar__skill ${spell ? spellAccentClass(spell.damageType) : 'action-bar__skill--empty'} ${spell ? 'is-on' : ''}`}
                    title={spell ? `${spell.name} — abrir Rotação do slot ${slot + 1}` : `Slot ${slot + 1} vazio — configurar rotação`}
                    onClick={() => setRotation({ ...member, policy: policyForRotation(member), slot })}
                  >
                    {spell ? <SpellIcon spell={spell} className="action-bar__skill-img" fallbackClassName="action-bar__skill-icon" fallback={spellShortLabel(spell)} /> : <span className="action-bar__plus">+</span>}
                    <span className="action-bar__slot-index">{slot + 1}</span>
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      </div>

      {rotation && (
        <RotationModal
          target={{ ...rotation, policy: overrides[rotation.id] ?? rotation.policy }}
          onClose={() => setRotation(null)}
          onOpenHelper={props.onOpenHelper}
          onSaved={(characterId, policy) => setOverrides((current) => ({ ...current, [characterId]: policy }))}
        />
      )}
    </>
  );
}
