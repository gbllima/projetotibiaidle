import { useState } from 'react';
import { spellsCatalog } from '@tibia-idle/data';
import { HEALTH_POTION_TIERS, HEAL_SPELLS, MANA_POTION_TIERS, SPIRIT_POTION_TIERS, SPELLS, healSpellsFor, runesFor, spellsFor, type HelperMode } from '@tibia-idle/sim';
import type { CharacterView } from '../api/types.js';
import { useLocale } from '../i18n/Locale.js';
import { ItemSlot } from './ItemSlot.js';
import { SpellIcon } from './SpellIcon.js';
import { WindowHead } from './WindowHead.js';

const PERCENTS = [0.2, 0.25, 0.35, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9];

type Section = 'cura' | 'escudo' | 'equip' | 'provocar' | 'atacar' | 'magias' | 'arvore' | 'runas' | 'suporte' | 'loot';

const SECTIONS: Array<{ id: Section; label: string }> = [
  { id: 'cura', label: '+ Cura' },
  { id: 'escudo', label: 'Escudo mágico' },
  { id: 'equip', label: 'Equipamento' },
  { id: 'provocar', label: 'Provocação' },
  { id: 'atacar', label: 'Atacar' },
  { id: 'magias', label: 'Magias de Ataque' },
  { id: 'arvore', label: 'Árvore de Magias' },
  { id: 'runas', label: 'Runas' },
  { id: 'suporte', label: 'Suporte' },
  { id: 'loot', label: 'Loot' },
];

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
  const { t } = useLocale();
  const [mode, setMode] = useState<HelperMode>('hunt');
  const [section, setSection] = useState<Section>(initialSection);
  const policy = mode === 'hunt' ? character.policy : (character.helperProfiles?.[mode] ?? character.policy);
  const save = (body: Record<string, unknown>) => onPolicy({ ...body, helperMode: mode });
  const heals = healSpellsFor(character.vocation.id, character.level);
  const attacks = spellsFor(character.vocation.id, character.level);
  const spellTree = spellsCatalog
    .filter((spell) => !spell.isRune && spell.allowedVocations.includes(character.vocation.name))
    .sort((a, b) => a.minimumCasterLevel - b.minimumCasterLevel || a.name.localeCompare(b.name));
  const healthPotion = HEALTH_POTION_TIERS.find((tier) => tier.itemId === policy.healthPotionId)
    ?? HEALTH_POTION_TIERS.filter((tier) => character.level >= tier.level).at(-1);
  const manaPotion = MANA_POTION_TIERS.find((tier) => tier.itemId === policy.manaPotionId)
    ?? MANA_POTION_TIERS.filter((tier) => character.level >= tier.level).at(-1);
  const heal = HEAL_SPELLS.find((spell) => spell.id === policy.healSpellId);
  const isPaladinOrMonk = [3, 7, 9, 10].includes(character.vocation.id);

  function toggleSpell(id: string) {
    const disabled = new Set(policy.disabledSpells);
    if (disabled.has(id)) disabled.delete(id);
    else disabled.add(id);
    save({ disabledSpells: [...disabled] });
  }

  function preferSpell(id: string) {
    save({
      spellPriority: [id, ...policy.spellPriority.filter((entry) => entry !== id)],
      disabledSpells: policy.disabledSpells.filter((entry) => entry !== id),
    });
  }

  return (
    <div className="modal" onClick={onClose}>
      <div className="helper-card" onClick={(event) => event.stopPropagation()}>
        <WindowHead
          title={t('helper')}
          extra={(
            <div className="helper-modes">
              {([['hunt', 'Hunt'], ['boss', 'Boss'], ['pvp', 'PVP']] as const).map(([id, label]) => (
                <button key={id} className={mode === id ? 'on' : ''} onClick={() => setMode(id)}>{label}</button>
              ))}
            </div>
          )}
          onClose={onClose}
          closeLabel={t('close')}
        />
        <p className="lede helper-mode-hint">{t('helperModeHint')}</p>

        <div className="helper-body">
          <nav className="helper-nav">
            {SECTIONS.map((entry) => (
              <button key={entry.id} className={section === entry.id ? 'on' : ''} onClick={() => setSection(entry.id)}>
                {entry.label}
              </button>
            ))}
          </nav>

          <div className="helper-main">
            {section === 'cura' && (
              <>
                <h3>+ Cura</h3>
                <HelperRow
                  checked={Boolean(policy.healSpellId)}
                  onCheck={(on) => save({ healSpellId: on ? (heals[0]?.id ?? '') : '' })}
                  icon={null}
                  label="Magia"
                  value={heal?.name ?? t('helperNone')}
                  options={[{ id: '', name: t('helperNone') }, ...heals.map((spell) => ({ id: spell.id, name: spell.name }))]}
                  selected={policy.healSpellId}
                  onSelect={(id) => save({ healSpellId: id })}
                  percent={policy.healSpellAt ?? 0.7}
                  onPercent={(value) => save({ healSpellAt: value })}
                  busy={busy}
                />
                <HelperRow
                  checked={policy.healthPotionId >= 0}
                  onCheck={(on) => save({ healthPotionId: on ? 0 : -1 })}
                  icon={healthPotion?.itemId}
                  label="Poção HP"
                  value={healthPotion?.name ?? t('helperNone')}
                  options={[{ id: '0', name: t('helperAuto') }, ...HEALTH_POTION_TIERS.filter((tier) => character.level >= tier.level).map((tier) => ({ id: String(tier.itemId), name: tier.name }))]}
                  selected={String(policy.healthPotionId > 0 ? policy.healthPotionId : 0)}
                  onSelect={(id) => save({ healthPotionId: Number(id) })}
                  percent={policy.healthPotionAt}
                  onPercent={(value) => save({ healthPotionAt: value })}
                  busy={busy}
                />
                <HelperRow
                  checked={policy.manaPotionId >= 0}
                  onCheck={(on) => save({ manaPotionId: on ? 0 : -1 })}
                  icon={policy.manaPotionId >= 0 ? manaPotion?.itemId : undefined}
                  label="Poção MP"
                  value={policy.manaPotionId < 0 ? t('helperNone') : (manaPotion?.name ?? t('helperAuto'))}
                  options={[{ id: '0', name: t('helperAuto') }, ...MANA_POTION_TIERS.filter((tier) => character.level >= tier.level).map((tier) => ({ id: String(tier.itemId), name: tier.name }))]}
                  selected={String(policy.manaPotionId > 0 ? policy.manaPotionId : 0)}
                  onSelect={(id) => save({ manaPotionId: Number(id) })}
                  percent={policy.manaPotionAt}
                  onPercent={(value) => save({ manaPotionAt: value })}
                  busy={busy}
                />
                {isPaladinOrMonk && (
                  <HelperRow
                    checked={(policy.spiritPotionId ?? -1) >= 0}
                    onCheck={(on) => save({ spiritPotionId: on ? 0 : -1 })}
                    icon={7642}
                    label="Spirit potion"
                    value={(policy.spiritPotionId ?? -1) < 0 ? t('helperNone') : t('helperAuto')}
                    options={[{ id: '0', name: t('helperAuto') }, ...SPIRIT_POTION_TIERS.filter((tier) => character.level >= tier.level).map((tier) => ({ id: String(tier.itemId), name: tier.name }))]}
                    selected={String((policy.spiritPotionId ?? 0) > 0 ? policy.spiritPotionId : 0)}
                    onSelect={(id) => save({ spiritPotionId: Number(id) })}
                    percent={policy.healthPotionAt}
                    onPercent={() => undefined}
                    busy={busy}
                    hidePercent
                  />
                )}
              </>
            )}

            {section === 'escudo' && (
              <>
                <h3>Escudo mágico</h3>
                <p className="lede" style={{ textAlign: 'left' }}>{t('helperShieldHint')}</p>
                <HelperRow
                  checked={policy.magicShield}
                  onCheck={(on) => save({ magicShield: on })}
                  icon={null}
                  label="utamo vita"
                  value={policy.magicShield ? 'utamo vita' : t('helperNone')}
                  options={[]}
                  selected=""
                  onSelect={() => undefined}
                  percent={policy.magicShieldAt ?? 0.4}
                  onPercent={(value) => save({ magicShieldAt: value })}
                  busy={busy}
                />
              </>
            )}

            {section === 'equip' && (
              <>
                <h3>Equipamento</h3>
                <p className="lede" style={{ textAlign: 'left' }}>{t('helperEquipHint')}</p>
                <div className="helper-gear">
                  {Object.entries(character.equipment).map(([slot, item]) => (
                    <div key={slot} className="helper-gear-row">
                      <ItemSlot itemId={item.id} label={item.name} />
                      <div>
                        <div>{item.name}</div>
                        <div className="meta">{slot}</div>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="kv" style={{ marginTop: 12 }}>
                  <span>{t('helperLoot')}</span>
                  <select value={policy.lootMinValue} disabled={busy} onChange={(event) => save({ lootMinValue: Number(event.target.value) })}>
                    <option value={0}>{t('helperKeepAll')}</option>
                    <option value={10}>10 gold</option>
                    <option value={50}>50 gold</option>
                    <option value={200}>200 gold</option>
                    <option value={1000}>1.000 gold</option>
                  </select>
                </div>
              </>
            )}

            {section === 'provocar' && (
              <>
                <h3>Provocação</h3>
                <p className="lede" style={{ textAlign: 'left' }}>{t('helperTauntHint')}</p>
                <label className="helper-check">
                  <input type="checkbox" checked={policy.taunt} disabled={busy} onChange={(event) => save({ taunt: event.target.checked })} />
                  exeta res
                </label>
              </>
            )}

            {section === 'atacar' && (
              <>
                <h3>Atacar</h3>
                <label className="helper-check">
                  <input type="checkbox" checked={policy.autoAttack !== false} disabled={busy} onChange={(event) => save({ autoAttack: event.target.checked })} />
                  {t('helperAutoAttack')}
                </label>
                <div className="kv" style={{ marginTop: 12 }}>
                  <span>{t('helperFlee')}</span>
                  <PercentSelect value={policy.fleeAt} onChange={(value) => save({ fleeAt: value })} disabled={busy} />
                  <span>{t('helperStopSupplies')}</span>
                  <select
                    value={policy.stopWhenOutOfSupplies ? '1' : '0'}
                    disabled={busy}
                    onChange={(event) => save({ stopWhenOutOfSupplies: event.target.value === '1' })}
                  >
                    <option value="1">{t('yes')}</option>
                    <option value="0">{t('no')}</option>
                  </select>
                </div>
              </>
            )}

            {section === 'magias' && (
              <>
                <h3>Magias de Ataque</h3>
                <p className="lede" style={{ textAlign: 'left' }}>{t('helperSpellsHint')}</p>
                {attacks.length === 0 && <p className="soon">{t('helperNoSpells')}</p>}
                {attacks.map((spell) => {
                  const off = policy.disabledSpells.includes(spell.id);
                  const rank = policy.spellPriority.indexOf(spell.id);
                  return (
                    <div className="hunt-row" key={spell.id}>
                      <div className="helper-icon">
                        <SpellIcon spell={spell} size={28} />
                      </div>
                      <div>
                        <div>{spell.name} <small className="meta">{spell.words}</small></div>
                        <div className="meta">
                          lvl {spell.level} · {spell.mana} mana · {spell.group}
                          {spell.harmony ? ` · harmony ${spell.harmony}` : ''}
                          {' · '}{spell.area ? 'área' : 'alvo'}
                        </div>
                      </div>
                      <div className="row" style={{ width: 200 }}>
                        <button className={`btn ${rank === 0 ? 'gold' : ''}`} disabled={busy} onClick={() => preferSpell(spell.id)}>
                          {rank >= 0 ? `#${rank + 1}` : t('helperUse')}
                        </button>
                        <button className={`btn ${off ? 'danger' : ''}`} disabled={busy} onClick={() => toggleSpell(spell.id)}>
                          {off ? 'off' : 'on'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </>
            )}

            {section === 'arvore' && (
              <>
                <h3>Árvore de Magias</h3>
                <p className="lede" style={{ textAlign: 'left' }}>
                  {character.name} · {character.vocation.name} · nível {character.level}
                </p>
                <div className="spell-tree">
                  {spellTree.length === 0 && <p className="soon">Nenhuma magia disponível para esta vocação.</p>}
                  {spellTree.map((spell) => {
                    const unlocked = character.level >= spell.minimumCasterLevel;
                    const configured = attacks.some((known) => known.name === spell.name) && policy.spellPriority.some((id) => attacks.find((known) => known.name === spell.name)?.id === id);
                    return (
                      <div className={`spell-tree-row ${unlocked ? 'is-unlocked' : 'is-locked'}`} key={spell.spellid}>
                        <div className="helper-icon"><span className="spell-tree-icon">{spell.iconIndex}</span></div>
                        <div className="spell-tree-copy">
                          <strong>{spell.name}</strong>
                          <span>{spell.formulaWithoutParams} · {spell.castCostMana ?? spell.manaCost ?? 0} mana · {spell.spellGroupPrimary.replace('SPELLGROUP_', '').toLowerCase()}</span>
                        </div>
                        <div className="spell-tree-status">
                          {unlocked ? (configured ? 'Na barra' : 'Liberada') : `Nível ${spell.minimumCasterLevel}`}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}

            {section === 'runas' && (
              <>
                <h3>Runas</h3>
                <p className="lede" style={{ textAlign: 'left' }}>{t('helperRuneHint')}</p>
                <div className={`helper-row ${(policy.runeId ?? -1) >= 0 ? 'on' : ''}`}>
                  <input
                    type="checkbox"
                    checked={(policy.runeId ?? -1) >= 0}
                    disabled={busy}
                    onChange={(event) => save({ runeId: event.target.checked ? 0 : -1 })}
                  />
                  <div className="helper-icon">
                    <ItemSlot itemId={policy.runeId > 0 ? policy.runeId : 3198} label="rune" />
                  </div>
                  <div className="helper-copy">
                    <small>{t('helperRune')}</small>
                    <select
                      value={String(policy.runeId > 0 ? policy.runeId : 0)}
                      disabled={busy || (policy.runeId ?? -1) < 0}
                      onChange={(event) => save({ runeId: Number(event.target.value) })}
                    >
                      <option value="0">{t('helperAuto')}</option>
                      {runesFor(character.vocation.id, character.level, character.magicLevel).map((rune) => (
                        <option key={rune.itemId} value={rune.itemId}>{rune.name} · lvl {rune.level}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className={`helper-row ${(policy.soulRuneId ?? -1) >= 0 ? 'on' : ''}`}>
                  <input
                    type="checkbox"
                    checked={(policy.soulRuneId ?? -1) >= 0}
                    disabled={busy || character.level < 27}
                    onChange={(event) => save({ soulRuneId: event.target.checked ? 0 : -1 })}
                  />
                  <div className="helper-icon">
                    <ItemSlot itemId={3195} label="soulfire" />
                  </div>
                  <div className="helper-copy">
                    <small>Soulfire · 1 soul</small>
                    <strong>{(policy.soulRuneId ?? -1) >= 0 ? 'on' : character.level < 27 ? 'lvl 27' : 'off'}</strong>
                  </div>
                </div>
                <div className={`helper-row ${(policy.supportRuneId ?? -1) >= 0 ? 'on' : ''}`}>
                  <input
                    type="checkbox"
                    checked={(policy.supportRuneId ?? -1) >= 0}
                    disabled={busy || character.level < 27}
                    onChange={(event) => save({ supportRuneId: event.target.checked ? 0 : -1 })}
                  />
                  <div className="helper-icon">
                    <ItemSlot itemId={3203} label="animate dead" />
                  </div>
                  <div className="helper-copy">
                    <small>Animate Dead · 2 soul · máx. 2</small>
                    <strong>{(policy.supportRuneId ?? -1) >= 0 ? 'on' : character.level < 27 ? 'lvl 27' : 'off'}</strong>
                  </div>
                </div>
              </>
            )}

            {section === 'suporte' && (
              <>
                <h3>Suporte</h3>
                <p className="lede" style={{ textAlign: 'left' }}>{t('helperSupportHint')}</p>
                <label className="helper-check">
                  <input type="checkbox" checked={policy.haste !== false} disabled={busy} onChange={(event) => save({ haste: event.target.checked })} />
                  utani hur
                </label>
                <label className="helper-check">
                  <input type="checkbox" checked={policy.food !== false} disabled={busy} onChange={(event) => save({ food: event.target.checked })} />
                  {t('helperFood')}
                </label>
                <label className="helper-check">
                  <input type="checkbox" checked={policy.cure !== false} disabled={busy} onChange={(event) => save({ cure: event.target.checked })} />
                  {t('helperCure')}
                </label>
                {(character.vocation.id === 9 || character.vocation.id === 10) && (
                  <>
                    <label className="helper-check">
                      <input type="checkbox" checked={policy.virtueHarmony !== false} disabled={busy} onChange={(event) => save({ virtueHarmony: event.target.checked })} />
                      Virtue of Harmony · utori virtu
                    </label>
                    <label className="helper-check">
                      <input type="checkbox" checked={policy.focusHarmony !== false} disabled={busy || character.level < 275} onChange={(event) => save({ focusHarmony: event.target.checked })} />
                      Focus Harmony · utevo nia {character.level < 275 ? '(lvl 275)' : ''}
                    </label>
                  </>
                )}
                <label className="helper-check">
                  <input type="checkbox" checked={policy.familiar !== false} disabled={busy || character.level < 200} onChange={(event) => save({ familiar: event.target.checked })} />
                  Familiar · utevo gran res {character.level < 200 ? '(lvl 200)' : ''}
                </label>
                {(character.vocation.id === 4 || character.vocation.id === 8) && (
                  <>
                    <label className="helper-check">
                      <input type="checkbox" checked={Boolean(policy.bloodRage)} disabled={busy || character.level < 60} onChange={(event) => save({ bloodRage: event.target.checked })} />
                      Blood Rage · utito tempo {character.level < 60 ? '(lvl 60)' : ''}
                    </label>
                    <label className="helper-check">
                      <input type="checkbox" checked={Boolean(policy.protector)} disabled={busy || character.level < 55} onChange={(event) => save({ protector: event.target.checked })} />
                      Protector · utamo tempo {character.level < 55 ? '(lvl 55)' : ''}
                    </label>
                  </>
                )}
                {(character.vocation.id === 3 || character.vocation.id === 7) && (
                  <label className="helper-check">
                    <input type="checkbox" checked={Boolean(policy.sharpshooter)} disabled={busy || character.level < 60} onChange={(event) => save({ sharpshooter: event.target.checked })} />
                    Sharpshooter · utori con {character.level < 60 ? '(lvl 60)' : ''}
                  </label>
                )}
              </>
            )}

            {section === 'loot' && (
              <>
                <h3>Loot</h3>
                <p className="lede" style={{ textAlign: 'left' }}>{t('helperLootHint')}</p>
                <div className="helper-row on">
                  <input
                    type="checkbox"
                    checked={Boolean(policy.lootToWarehouse)}
                    disabled={busy}
                    onChange={(event) => save({ lootToWarehouse: event.target.checked })}
                  />
                  <div className="helper-icon"><span className="helper-spell">⌂</span></div>
                  <div className="helper-copy">
                    <small>{t('helperLootDepot')}</small>
                    <strong>{policy.lootToWarehouse ? t('helperLootKeep') : t('helperLootSell')}</strong>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        <footer className="helper-foot">
          {mode !== 'hunt' && (
            <>
              <button className="btn" disabled={busy} onClick={() => save({ helperCopyFrom: 'hunt' })}>Copiar do Hunt</button>
              <button className="btn" disabled={busy} onClick={() => save({ helperReset: true })}>Resetar</button>
            </>
          )}
          <button className="btn" onClick={onClose}>{t('close')}</button>
        </footer>
      </div>
    </div>
  );
}

function HelperRow({
  checked,
  onCheck,
  icon,
  label,
  value,
  options,
  selected,
  onSelect,
  percent,
  onPercent,
  busy,
  hidePercent,
}: {
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
    <div className={`helper-row ${checked ? 'on' : ''}`}>
      <input type="checkbox" checked={checked} disabled={busy} onChange={(event) => onCheck(event.target.checked)} />
      <div className="helper-icon">{icon ? <ItemSlot itemId={icon} label={value} /> : <span className="helper-spell">✦</span>}</div>
      <div className="helper-copy">
        <small>{label}</small>
        {options.length > 0 ? (
          <select value={selected} disabled={busy} onChange={(event) => onSelect(event.target.value)}>
            {options.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
          </select>
        ) : (
          <strong>{value}</strong>
        )}
      </div>
      {!hidePercent && (
        <>
          <span className="helper-lt">&lt;</span>
          <PercentSelect value={percent} onChange={onPercent} disabled={busy} />
        </>
      )}
    </div>
  );
}

function PercentSelect({ value, onChange, disabled }: { value: number; onChange: (value: number) => void; disabled: boolean }) {
  const options = PERCENTS.includes(value) ? PERCENTS : [...PERCENTS, value].sort((a, b) => a - b);
  return (
    <select className="helper-pct" value={String(value)} disabled={disabled} onChange={(event) => onChange(Number(event.target.value))}>
      {options.map((entry) => (
        <option key={entry} value={entry}>{Math.round(entry * 100)}%</option>
      ))}
    </select>
  );
}
