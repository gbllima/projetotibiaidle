import type { CharacterView } from '../api/types.js';
import { formatNumber } from '../format.js';

const SLOTS = ['head', 'necklace', 'armor', 'right', 'left', 'legs', 'feet', 'ring', 'ammo', 'backpack'] as const;

export function CharacterPanel({
  character,
  busy,
  onUpgrade,
}: {
  character: CharacterView;
  busy: boolean;
  onUpgrade: () => void;
}) {
  return (
    <aside className="panel">
      <h3>Personagem</h3>
      <div className="kv" style={{ marginTop: 12 }}>
        <span>Vocação</span>
        <strong>{character.vocation.name}</strong>
        <span>Magic Level</span>
        <strong>{character.magicLevel}</strong>
        <span>{character.stats.attackSkillName}</span>
        <strong>{character.stats.attackSkill}</strong>
        <span>Defesa</span>
        <strong>{character.stats.defense}</strong>
        <span>Armadura</span>
        <strong>{character.stats.armor}</strong>
        <span>Mitigation</span>
        <strong>{character.stats.mitigation.toFixed(1)}</strong>
        <span>DPS</span>
        <strong>{formatNumber(character.stats.damagePerSecond)}</strong>
      </div>

      <h3 style={{ marginTop: 22 }}>Skills</h3>
      <div className="kv" style={{ marginTop: 12 }}>
        {Object.entries(character.skills).map(([name, skill]) => (
          <span key={name} style={{ display: 'contents' }}>
            <span>{name}</span>
            <strong>{skill.level}</strong>
          </span>
        ))}
      </div>

      <h3 style={{ marginTop: 22 }}>Equipamento</h3>
      <div className="slots">
        {SLOTS.map((slot) => (
          <div className="slot" key={slot}>
            <small>{slot}</small>
            {character.equipment[slot]?.name ?? '—'}
          </div>
        ))}
      </div>
      <button className="btn" style={{ width: '100%', marginTop: 12 }} disabled={busy || Boolean(character.session)} onClick={onUpgrade}>
        Melhorar equipamento
      </button>
    </aside>
  );
}
