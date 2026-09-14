import { useEffect, useMemo, useState } from 'react';
import {
  HEALTH_POTION_TIERS,
  HEAL_SPELLS,
  MANA_POTION_TIERS,
  SPIRIT_POTION_TIERS,
  healSpellsFor,
  runesFor,
  spellsFor,
  type HelperMode,
} from '@tibia-idle/sim';
import type { CharacterView } from '../api/types.js';
import { api } from '../api/client.js';
import { outfitIconUrl } from '../render/outfitIcon.js';
import { ItemSlot } from './ItemSlot.js';
import { SpellIcon } from './SpellIcon.js';

const PERCENTS = [0.2, 0.25, 0.35, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.95];
const VOC_SHORT: Record<number, string> = {
  1: 'MS', 2: 'ED', 3: 'RP', 4: 'EK', 5: 'MS', 6: 'ED', 7: 'RP', 8: 'EK', 9: 'MK', 10: 'MK',
};

const PARTY_HEAL_PREFIX = '__partyheal:';
type BaseVocation = 1 | 2 | 3 | 4 | 9;

type AllyHealSettings = {
  enabled: boolean;
  selfFirst: boolean;
  priority: Record<BaseVocation, number>;
  threshold: Record<BaseVocation, number>;
};

const ALLY_VOCATIONS: Array<{ id: BaseVocation; label: string }> = [
  { id: 4, label: 'Knight' },
  { id: 9, label: 'Monk' },
  { id: 3, label: 'Paladin' },
  { id: 2, label: 'Druid' },
  { id: 1, label: 'Sorcerer' },
];

const DEFAULT_ALLY_PRIORITY: Record<BaseVocation, number> = {
  4: 1,
  9: 1,
  3: 2,
  2: 3,
  1: 3,
};

const DEFAULT_ALLY_THRESHOLD: Record<BaseVocation, number> = {
  4: 0.9,
  9: 0.9,
  3: 0.9,
  2: 0.9,
  1: 0.9,
};

type Section = 'cura' | 'aliado' | 'escudo' | 'equip' | 'atacar' | 'magias' | 'taticas';

const SECTIONS: Array<{ id: Section; label: string; icon: string }> = [
  { id: 'cura', label: 'Cura', icon: '✚' },
  { id: 'aliado', label: 'Curar aliado', icon: '♥' },
  { id: 'escudo', label: 'Escudo mágico', icon: '◆' },
  { id: 'equip', label: 'Equipamento', icon: '◇' },
  { id: 'atacar', label: 'Atacar', icon: '⊙' },
  { id: 'magias', label: 'Magias de Ataque', icon: '↗' },
  { id: 'taticas', label: 'Táticas', icon: '╬' },
];

function readAllyHealSettings(disabledSpells: string[]): AllyHealSettings {
  const tokens = disabledSpells.filter((entry) => entry.startsWith(PARTY_HEAL_PREFIX));
  const configured = tokens.length > 0;
  const settings: AllyHealSettings = {
    enabled: configured ? tokens.includes(`${PARTY_HEAL_PREFIX}on`) : true,
    selfFirst: configured ? tokens.includes(`${PARTY_HEAL_PREFIX}self`) : true,
    priority: { ...DEFAULT_ALLY_PRIORITY },
    threshold: { ...DEFAULT_ALLY_THRESHOLD },
  };

  for (const token of tokens) {
    const payload = token.slice(PARTY_HEAL_PREFIX.length);
    const priority = /^p:(1|2|3|4|9)=(1|2|3)$/.exec(payload);
    if (priority) {
      settings.priority[Number(priority[1]) as BaseVocation] = Number(priority[2]);
      continue;
    }
    const threshold = /^t:(1|2|3|4|9)=(\d{1,3})$/.exec(payload);
    if (threshold) {
      settings.threshold[Number(threshold[1]) as BaseVocation] = Math.max(0.2, Math.min(0.95, Number(threshold[2]) / 100));
    }
  }
  return settings;
}

function encodeAllyHealSettings(disabledSpells: string[], settings: AllyHealSettings): string[] {
  const normal = disabledSpells.filter((entry) => !entry.startsWith(PARTY_HEAL_PREFIX));
  const tokens = [`${PARTY_HEAL_PREFIX}configured`];
  if (settings.enabled) tokens.push(`${PARTY_HEAL_PREFIX}on`);
  if (settings.selfFirst) tokens.push(`${PARTY_HEAL_PREFIX}self`);
  for (const vocation of ALLY_VOCATIONS) {
    tokens.push(`${PARTY_HEAL_PREFIX}p:${vocation.id}=${settings.priority[vocation.id]}`);
    tokens.push(`${PARTY_HEAL_PREFIX}t:${vocation.id}=${Math.round(settings.threshold[vocation.id] * 100)}`);
  }
  return [...normal, ...tokens];
}

function HelperPortrait({ appearance, vocationId }: { appearance?: CharacterView['appearance']; vocationId: number }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    if (!appearance) {
      setUrl(null);
      return () => { alive = false; };
    }
    void outfitIconUrl(appearance.outfit, 34, {
      head: appearance.head,
      body: appearance.body,
      legs: appearance.legs,
      feet: appearance.feet,
    }, appearance.addons ?? 0).then((next) => { if (alive) setUrl(next); });
    return () => { alive = false; };
  }, [appearance]);
  return url ? <img src={url} alt="" /> : <span>{VOC_SHORT[vocationId] ?? '?'}</span>;
}

function mergePolicy(character: CharacterView, mode: HelperMode, patch: Record<string, unknown>): CharacterView {
  if (mode === 'hunt') return { ...character, policy: { ...character.policy, ...patch } as CharacterView['policy'] };
  const current = character.helperProfiles?.[mode] ?? character.policy;
  return {
    ...character,
    helperProfiles: {
      ...character.helperProfiles,
      [mode]: { ...current, ...patch } as CharacterView['policy'],
    },
  };
}

export function HelperModal({
  character,
  busy,
  onClose,
  onPolicy,
  initialSection = 'cura',
}: {
  character: CharacterView;
  busy: boolean;
  onClose: () => void;
  onPolicy: (patch: Record<string, unknown>) => void;
  initialSection?: Section;
}) {
  const [mode, setMode] = useState<HelperMode>('hunt');
  const [section, setSection] = useState<Section>(initialSection);
  const [active, setActive] = useState<CharacterView>(character);
  const [loadingMember, setLoadingMember] = useState(false);
  const [localBusy, setLocalBusy] = useState(false);

  useEffect(() => setActive(character), [character.id]);

  const policy = mode === 'hunt' ? active.policy : (active.helperProfiles?.[mode] ?? active.policy);
  const heals = healSpellsFor(active.vocation.id, active.level);
  const attacks = spellsFor(active.vocation.id, active.level);
  const healthPotion = HEALTH_POTION_TIERS.find((tier) => tier.itemId === policy.healthPotionId)
    ?? HEALTH_POTION_TIERS.filter((tier) => active.level >= tier.level).at(-1);
  const manaPotion = MANA_POTION_TIERS.find((tier) => tier.itemId === policy.manaPotionId)
    ?? MANA_POTION_TIERS.filter((tier) => active.level >= tier.level).at(-1);
  const heal = HEAL_SPELLS.find((spell) => spell.id === policy.healSpellId);
  const disabled = busy || localBusy;
  const allyHeal = useMemo(() => readAllyHealSettings(policy.disabledSpells), [policy.disabledSpells]);
  const canCastHealFriend = [2, 6].includes(active.vocation.id) && active.level >= 18;

  const party = useMemo(() => {
    const source = active.caveParty?.length ? active.caveParty : character.caveParty;
    const entries = source.map((member) => ({
      id: member.id,
      name: member.name,
      level: member.level,
      vocationId: member.vocationId,
      appearance: member.appearance,
      health: member.health,
      maxHealth: member.maxHealth,
      self: member.self,
    }));
    if (!entries.some((entry) => entry.id === active.id)) {
      entries.unshift({
        id: active.id,
        name: active.name,
        level: active.level,
        vocationId: active.vocation.id,
        appearance: active.appearance,
        health: active.health,
        maxHealth: active.maxHealth,
        self: true,
      });
    }
    return entries;
  }, [active.id, active.caveParty, active.name, active.level, active.vocation.id, active.appearance, active.health, active.maxHealth, character.caveParty]);

  function save(patch: Record<string, unknown>) {
    setActive((current) => mergePolicy(current, mode, patch));
    if (active.id === character.id) {
      onPolicy({ ...patch, helperMode: mode });
      return;
    }
    setLocalBusy(true);
    void api.act(active.id, { type: 'policy', ...patch, helperMode: mode }).then((result) => {
      setActive(result.character);
    }).finally(() => setLocalBusy(false));
  }

  function saveAllyHeal(next: AllyHealSettings) {
    save({ disabledSpells: encodeAllyHealSettings(policy.disabledSpells, next) });
  }

  function selectMember(id: number) {
    if (id === active.id) return;
    setLoadingMember(true);
    void api.character(id).then((result) => {
      setActive(result.character);
    }).finally(() => setLoadingMember(false));
  }

  function toggleSpell(id: string) {
    const next = new Set(policy.disabledSpells);
    if (next.has(id)) next.delete(id); else next.add(id);
    save({ disabledSpells: [...next] });
  }

  function preferSpell(id: string) {
    save({
      spellPriority: [id, ...policy.spellPriority.filter((entry) => entry !== id)],
      disabledSpells: policy.disabledSpells.filter((entry) => entry !== id),
    });
  }

  return (
    <div className="modal helper-compact-modal" onClick={onClose}>
      <section className="helper-card helper-card--compact" onClick={(event) => event.stopPropagation()}>
        <header className="helper-topline">
          <div className="helper-party-tabs" aria-label="Personagens da party">
            {party.map((member) => (
              <button key={member.id} type="button" className={active.id === member.id ? 'on' : ''} disabled={loadingMember} onClick={() => selectMember(member.id)}>
                <HelperPortrait appearance={member.appearance as CharacterView['appearance'] | undefined} vocationId={member.vocationId} />
                <b>{VOC_SHORT[member.vocationId] ?? '?'}</b>
              </button>
            ))}
          </div>
          <h2>Helper</h2>
          <div className="helper-modes">
            {([['hunt', 'Hunt'], ['boss', 'Boss'], ['pvp', 'PVP']] as const).map(([id, label]) => (
              <button key={id} type="button" className={mode === id ? 'on' : ''} onClick={() => setMode(id)}>{label}</button>
            ))}
          </div>
        </header>

        <div className="helper-body helper-body--compact">
          <nav className="helper-nav helper-nav--compact">
            {SECTIONS.map((entry) => (
              <button key={entry.id} type="button" className={section === entry.id ? 'on' : ''} onClick={() => setSection(entry.id)}>
                <span>{entry.icon}</span>{entry.label}
              </button>
            ))}
          </nav>

          <main className="helper-main helper-main--compact">
            <div className="helper-section-title">
              <h3>{SECTIONS.find((entry) => entry.id === section)?.icon} {SECTIONS.find((entry) => entry.id === section)?.label}</h3>
              {section !== 'aliado' && <small>{active.name} · {active.vocation.name} · lvl {active.level}</small>}
            </div>

            {section === 'cura' && (
              <div className="helper-stack">
                <HelperRow checked={Boolean(policy.healSpellId)} onCheck={(on) => save({ healSpellId: on ? (heals[0]?.id ?? '') : '' })} icon={null} label="Magia" value={heal?.name ?? 'Nenhuma'} options={[{ id: '', name: 'Nenhuma' }, ...heals.map((spell) => ({ id: spell.id, name: spell.name }))]} selected={policy.healSpellId} onSelect={(id) => save({ healSpellId: id })} percent={policy.healSpellAt ?? 0.7} onPercent={(value) => save({ healSpellAt: value })} busy={disabled} />
                <HelperRow checked={policy.healthPotionId >= 0} onCheck={(on) => save({ healthPotionId: on ? 0 : -1 })} icon={healthPotion?.itemId} label="Poção HP" value={healthPotion?.name ?? 'Automática'} options={[{ id: '0', name: 'Automática' }, ...HEALTH_POTION_TIERS.filter((tier) => active.level >= tier.level).map((tier) => ({ id: String(tier.itemId), name: tier.name }))]} selected={String(policy.healthPotionId > 0 ? policy.healthPotionId : 0)} onSelect={(id) => save({ healthPotionId: Number(id) })} percent={policy.healthPotionAt} onPercent={(value) => save({ healthPotionAt: value })} busy={disabled} />
                <HelperRow checked={policy.manaPotionId >= 0} onCheck={(on) => save({ manaPotionId: on ? 0 : -1 })} icon={manaPotion?.itemId} label="Poção MP" value={manaPotion?.name ?? 'Automática'} options={[{ id: '0', name: 'Automática' }, ...MANA_POTION_TIERS.filter((tier) => active.level >= tier.level).map((tier) => ({ id: String(tier.itemId), name: tier.name }))]} selected={String(policy.manaPotionId > 0 ? policy.manaPotionId : 0)} onSelect={(id) => save({ manaPotionId: Number(id) })} percent={policy.manaPotionAt} onPercent={(value) => save({ manaPotionAt: value })} busy={disabled} />
                {[3, 7, 9, 10].includes(active.vocation.id) && (
                  <HelperRow checked={(policy.spiritPotionId ?? -1) >= 0} onCheck={(on) => save({ spiritPotionId: on ? 0 : -1 })} icon={7642} label="Spirit potion" value="Automática" options={[{ id: '0', name: 'Automática' }, ...SPIRIT_POTION_TIERS.filter((tier) => active.level >= tier.level).map((tier) => ({ id: String(tier.itemId), name: tier.name }))]} selected={String((policy.spiritPotionId ?? 0) > 0 ? policy.spiritPotionId : 0)} onSelect={(id) => save({ spiritPotionId: Number(id) })} percent={policy.healthPotionAt} onPercent={() => undefined} busy={disabled} hidePercent />
                )}
              </div>
            )}

            {section === 'aliado' && (
              <div className="helper-ally-config">
                <div className="helper-ally-switches">
                  <label>
                    <input
                      type="checkbox"
                      checked={allyHeal.enabled}
                      disabled={disabled || !canCastHealFriend}
                      onChange={(event) => saveAllyHeal({ ...allyHeal, enabled: event.target.checked })}
                    />
                    <span>Curar aliado</span>
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={allyHeal.selfFirst}
                      disabled={disabled}
                      onChange={(event) => saveAllyHeal({ ...allyHeal, selfFirst: event.target.checked })}
                    />
                    <span>Priorizar minha cura</span>
                  </label>
                </div>

                <div className="helper-ally-table" role="table" aria-label="Prioridade de cura por vocação">
                  <div className="helper-ally-table-head" role="row">
                    <span>VOCAÇÃO</span>
                    <span>PRIORIDADE</span>
                    <span>CURA EM</span>
                  </div>
                  {ALLY_VOCATIONS.map((vocation) => (
                    <div className="helper-ally-priority-row" role="row" key={vocation.id}>
                      <span>{vocation.label}</span>
                      <select
                        aria-label={`Prioridade ${vocation.label}`}
                        value={allyHeal.priority[vocation.id]}
                        disabled={disabled}
                        onChange={(event) => saveAllyHeal({
                          ...allyHeal,
                          priority: { ...allyHeal.priority, [vocation.id]: Number(event.target.value) },
                        })}
                      >
                        <option value={1}>1</option>
                        <option value={2}>2</option>
                        <option value={3}>3</option>
                      </select>
                      <PercentSelect
                        value={allyHeal.threshold[vocation.id]}
                        disabled={disabled}
                        onChange={(value) => saveAllyHeal({
                          ...allyHeal,
                          threshold: { ...allyHeal.threshold, [vocation.id]: value },
                        })}
                      />
                    </div>
                  ))}
                </div>

                <p className="helper-ally-hint">Cura o aliado de MENOR prioridade abaixo do seu gatilho (empate = mais ferido). Exura sio.</p>
                {!canCastHealFriend && (
                  <p className="helper-ally-warning">Exura sio é executado por Druid/Elder Druid a partir do nível 18. Selecione o ED no topo para configurar a cura da party.</p>
                )}
              </div>
            )}

            {section === 'escudo' && (
              <div className="helper-stack">
                <label className="helper-toggle-line"><input type="checkbox" checked={policy.magicShield} disabled={disabled} onChange={(event) => save({ magicShield: event.target.checked })} /><strong>Magic Shield</strong></label>
                <div className="helper-choice-grid"><button type="button" className="on">Trocar por HP</button><button type="button" disabled>Sempre ativo</button></div>
                <div className="helper-kv"><span>Utamo Vita abaixo de</span><PercentSelect value={policy.magicShieldAt ?? 0.4} onChange={(value) => save({ magicShieldAt: value })} disabled={disabled} /><span>Fugir abaixo de</span><PercentSelect value={policy.fleeAt} onChange={(value) => save({ fleeAt: value })} disabled={disabled} /></div>
                <p className="helper-explain">Quando ativo, o simulador converte dano recebido em mana enquanto a vida está abaixo do gatilho configurado.</p>
              </div>
            )}

            {section === 'equip' && (
              <div className="helper-stack">
                <div className="helper-gear-grid">
                  {Object.entries(active.equipment).map(([slot, item]) => (
                    <div key={slot} className="helper-gear-row"><ItemSlot itemId={item.id} label={item.name} /><span><strong>{item.name}</strong><small>{slot}</small></span></div>
                  ))}
                </div>
                <div className="helper-kv"><span>Guardar loot a partir de</span><select value={policy.lootMinValue} disabled={disabled} onChange={(event) => save({ lootMinValue: Number(event.target.value) })}><option value={0}>Guardar tudo</option><option value={10}>10 gold</option><option value={50}>50 gold</option><option value={200}>200 gold</option><option value={1000}>1.000 gold</option></select></div>
                <label className="helper-toggle-line"><input type="checkbox" checked={Boolean(policy.lootToWarehouse)} disabled={disabled} onChange={(event) => save({ lootToWarehouse: event.target.checked })} /><strong>Enviar loot restante ao Depot</strong></label>
              </div>
            )}

            {section === 'atacar' && (
              <div className="helper-stack">
                <div className="helper-choice-grid"><button type="button" className={policy.autoAttack !== false ? 'on' : ''} onClick={() => save({ autoAttack: true })}>Automático</button><button type="button" className={policy.autoAttack === false ? 'on' : ''} onClick={() => save({ autoAttack: false })}>Não atacar</button></div>
                <div className="helper-kv"><span>Fugir com HP abaixo de</span><PercentSelect value={policy.fleeAt} onChange={(value) => save({ fleeAt: value })} disabled={disabled} /><span>Sem supplies</span><select value={policy.stopWhenOutOfSupplies ? '1' : '0'} disabled={disabled} onChange={(event) => save({ stopWhenOutOfSupplies: event.target.value === '1' })}><option value="1">Parar a hunt</option><option value="0">Continuar</option></select></div>
                <label className="helper-toggle-line"><input type="checkbox" checked={policy.taunt} disabled={disabled} onChange={(event) => save({ taunt: event.target.checked })} /><strong>Provocar / exeta res</strong></label>
                <p className="helper-explain">O posicionamento continua automático pela vocação: melee aproxima e distância mantém alcance sempre que possível.</p>
              </div>
            )}

            {section === 'magias' && (
              <div className="helper-stack">
                <div className="helper-rotation-preview">
                  {policy.spellPriority.slice(0, 4).map((id, index) => {
                    const spell = attacks.find((entry) => entry.id === id);
                    return spell ? <div key={id}><SpellIcon spell={spell} size={36} /><span>#{index + 1}</span></div> : null;
                  })}
                </div>
                {attacks.length === 0 && <p className="helper-explain">Nenhuma magia de ataque disponível neste nível.</p>}
                {attacks.map((spell) => {
                  const off = policy.disabledSpells.includes(spell.id);
                  const rank = policy.spellPriority.indexOf(spell.id);
                  return (
                    <article className={`helper-spell-row ${off ? 'off' : ''}`} key={spell.id}>
                      <SpellIcon spell={spell} size={38} />
                      <span><strong>{spell.name}</strong><b>{spell.words}</b><small>lvl {spell.level} · {spell.mana} mana · {spell.area ? 'área' : 'alvo'}</small></span>
                      <button type="button" className={rank === 0 ? 'gold' : ''} disabled={disabled} onClick={() => preferSpell(spell.id)}>{rank >= 0 ? `#${rank + 1}` : 'Usar'}</button>
                      <button type="button" className={off ? 'danger' : ''} disabled={disabled} onClick={() => toggleSpell(spell.id)}>{off ? 'Off' : 'On'}</button>
                    </article>
                  );
                })}
              </div>
            )}

            {section === 'taticas' && (
              <div className="helper-stack">
                <div className="helper-tactic-grid">
                  <label><input type="checkbox" checked={policy.haste !== false} disabled={disabled} onChange={(event) => save({ haste: event.target.checked })} /> Haste</label>
                  <label><input type="checkbox" checked={policy.food !== false} disabled={disabled} onChange={(event) => save({ food: event.target.checked })} /> Food</label>
                  <label><input type="checkbox" checked={policy.cure !== false} disabled={disabled} onChange={(event) => save({ cure: event.target.checked })} /> Curar condições</label>
                  <label><input type="checkbox" checked={policy.familiar !== false} disabled={disabled || active.level < 200} onChange={(event) => save({ familiar: event.target.checked })} /> Familiar</label>
                  {([4, 8].includes(active.vocation.id)) && <><label><input type="checkbox" checked={Boolean(policy.bloodRage)} disabled={disabled || active.level < 60} onChange={(event) => save({ bloodRage: event.target.checked })} /> Blood Rage</label><label><input type="checkbox" checked={Boolean(policy.protector)} disabled={disabled || active.level < 55} onChange={(event) => save({ protector: event.target.checked })} /> Protector</label></>}
                  {([3, 7].includes(active.vocation.id)) && <label><input type="checkbox" checked={Boolean(policy.sharpshooter)} disabled={disabled || active.level < 60} onChange={(event) => save({ sharpshooter: event.target.checked })} /> Sharpshooter</label>}
                  {([9, 10].includes(active.vocation.id)) && <><label><input type="checkbox" checked={policy.virtueHarmony !== false} disabled={disabled} onChange={(event) => save({ virtueHarmony: event.target.checked })} /> Virtue Harmony</label><label><input type="checkbox" checked={policy.focusHarmony !== false} disabled={disabled || active.level < 275} onChange={(event) => save({ focusHarmony: event.target.checked })} /> Focus Harmony</label></>}
                </div>
                <div className="helper-rune-panel">
                  <h4>Runas</h4>
                  <select value={String(policy.runeId ?? -1)} disabled={disabled} onChange={(event) => save({ runeId: Number(event.target.value) })}>
                    <option value="-1">Desativadas</option><option value="0">Automática</option>
                    {runesFor(active.vocation.id, active.level, active.magicLevel).map((rune) => <option key={rune.itemId} value={rune.itemId}>{rune.name}</option>)}
                  </select>
                  <label><input type="checkbox" checked={(policy.soulRuneId ?? -1) >= 0} disabled={disabled || active.level < 27} onChange={(event) => save({ soulRuneId: event.target.checked ? 0 : -1 })} /> Soulfire</label>
                  <label><input type="checkbox" checked={(policy.supportRuneId ?? -1) >= 0} disabled={disabled || active.level < 27} onChange={(event) => save({ supportRuneId: event.target.checked ? 0 : -1 })} /> Animate Dead</label>
                </div>
              </div>
            )}
          </main>
        </div>

        <footer className="helper-foot helper-foot--compact">
          <span>{loadingMember ? 'Carregando personagem…' : `${active.name} · ${mode.toUpperCase()}`}</span>
          <div>
            {mode !== 'hunt' && <><button type="button" disabled={disabled} onClick={() => save({ helperCopyFrom: 'hunt' })}>Copiar Hunt</button><button type="button" disabled={disabled} onClick={() => save({ helperReset: true })}>Resetar</button></>}
            <button type="button" onClick={onClose}>Fechar</button>
          </div>
        </footer>
      </section>
    </div>
  );
}

function HelperRow({ checked, onCheck, icon, label, value, options, selected, onSelect, percent, onPercent, busy, hidePercent }: {
  checked: boolean;
  onCheck: (on: boolean) => void;
  icon: number | null | undefined;
  label: string;
  value: string;
  options: Array<{ id: string; name: string }>;
  selected: string;
  onSelect: (id: string) => void;
  percent: number;
  onPercent: (value: number) => void;
  busy: boolean;
  hidePercent?: boolean;
}) {
  return (
    <div className={`helper-row helper-row--compact ${checked ? 'on' : ''}`}>
      <input type="checkbox" checked={checked} disabled={busy} onChange={(event) => onCheck(event.target.checked)} />
      <div className="helper-icon">{icon ? <ItemSlot itemId={icon} label={value} /> : <span className="helper-spell">✦</span>}</div>
      <div className="helper-copy"><small>{label}</small>{options.length ? <select value={selected} disabled={busy} onChange={(event) => onSelect(event.target.value)}>{options.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}</select> : <strong>{value}</strong>}</div>
      {!hidePercent && <><span className="helper-lt">&lt;</span><PercentSelect value={percent} onChange={onPercent} disabled={busy} /></>}
    </div>
  );
}

function PercentSelect({ value, onChange, disabled }: { value: number; onChange: (value: number) => void; disabled: boolean }) {
  const options = PERCENTS.includes(value) ? PERCENTS : [...PERCENTS, value].sort((a, b) => a - b);
  return <select className="helper-pct" value={String(value)} disabled={disabled} onChange={(event) => onChange(Number(event.target.value))}>{options.map((entry) => <option key={entry} value={entry}>{Math.round(entry * 100)}%</option>)}</select>;
}
