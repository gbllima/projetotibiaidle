import { useEffect, useState } from 'react';
import type { Spell } from '@tibia-idle/sim';
import type { CharacterView } from '../api/types.js';
import { outfitIconUrl } from '../render/outfitIcon.js';
import { SpellIcon } from './SpellIcon.js';

const VOC_SHORT: Record<number, string> = {
  1: 'MS', 2: 'ED', 3: 'RP', 4: 'EK', 5: 'MS', 6: 'ED', 7: 'RP', 8: 'EK', 9: 'EM', 10: 'EM',
};

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

function Portrait({ character }: { character: CharacterView }) {
  const [url, setUrl] = useState<string | null>(null);
  const voc = VOC_SHORT[character.vocation.id] ?? '?';

  useEffect(() => {
    let alive = true;
    void outfitIconUrl(
      character.appearance.outfit,
      44,
      {
        head: character.appearance.head,
        body: character.appearance.body,
        legs: character.appearance.legs,
        feet: character.appearance.feet,
      },
      character.appearance.addons ?? 0,
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
  ]);

  return (
    <div className="action-bar__portrait" title={character.name}>
      {url ? <img src={url} alt="" /> : <span className="action-bar__portrait-fallback">{voc}</span>}
      <span className="action-bar__portrait-tag">{voc}</span>
    </div>
  );
}

function SpellSlot({
  spell,
  off,
  rank,
  hint,
  onSpellPriority,
  onSpellToggle,
}: {
  spell: Spell;
  off: boolean;
  rank: number;
  hint: string;
  onSpellPriority: (spell: Spell) => void;
  onSpellToggle: (spell: Spell, disabled: boolean) => void;
}) {
  const priority = rank === 0;

  return (
    <button
      type="button"
      className={`action-bar__skill ${spellAccentClass(spell.damageType)} ${off ? 'is-off' : 'is-on'} ${priority ? 'is-priority' : ''}`}
      title={`${spell.name} (${spell.words}) — ${hint}`}
      onClick={() => onSpellPriority(spell)}
      onContextMenu={(event) => {
        event.preventDefault();
        onSpellToggle(spell, !off);
      }}
    >
      <SpellIcon
        spell={spell}
        className="action-bar__skill-img"
        fallbackClassName="action-bar__skill-icon"
        fallback={spellShortLabel(spell)}
      />
      {rank >= 0 && <span className="action-bar__rank">#{rank + 1}</span>}
    </button>
  );
}

export function ActionBar({
  character,
  spells,
  onAutoAttack,
  onSpellPriority,
  onSpellToggle,
  onOpenSpells,
  hint,
  spellsConfigLabel,
}: {
  character: CharacterView;
  spells: Spell[];
  onAutoAttack: () => void;
  onSpellPriority: (spell: Spell) => void;
  onSpellToggle: (spell: Spell, disabled: boolean) => void;
  onOpenSpells: () => void;
  hint: string;
  spellsConfigLabel: string;
}) {
  const autoOn = character.policy?.autoAttack !== false;

  return (
    <div className="action-bar">
      <div className="action-bar__panel">
        <Portrait character={character} />
        <button
          type="button"
          className={`action-bar__skill spell-physical ${autoOn ? 'is-on' : 'is-off'}`}
          title="Auto-attack"
          onClick={onAutoAttack}
        >
          <span className="action-bar__skill-icon">⚔</span>
          <span className="action-bar__skill-label">ATK</span>
        </button>
        {spells.map((spell, index) => (
            <SpellSlot
              key={spell.id}
              spell={spell}
              off={false}
              rank={index}
              hint={hint}
              onSpellPriority={onSpellPriority}
              onSpellToggle={onSpellToggle}
            />
          ))}
        <button
          type="button"
          className="action-bar__skill action-bar__skill--empty"
          title={spellsConfigLabel}
          onClick={onOpenSpells}
        >
          <span className="action-bar__plus">+</span>
        </button>
      </div>
    </div>
  );
}
