import { useEffect, useState } from 'react';
import { huntsById, itemsById, monstersById } from '@tibia-idle/data';
import { blessingCount, magicProgressPercent, skillProgressPercent, staminaMultiplier } from '@tibia-idle/sim';
import type { CharacterView } from '../api/types.js';
import { api } from '../api/client.js';
import { formatDuration, formatNumber, formatRate, formatStamina, staminaTone, xpProgress } from '../format.js';
import { itemTooltipLines } from '../itemFormat.js';
import { DockBox } from './DockBox.js';
import { ItemSlot } from './ItemSlot.js';

function partyNeed(sizes: readonly string[]): number {
  if (sizes.includes('solo') || sizes.length === 0) return 1;
  if (sizes.includes('duo')) return 2;
  return 3;
}

function partyLabel(sizes: readonly string[]): string {
  if (sizes.includes('party4') && !sizes.includes('duo') && !sizes.includes('solo')) return 'Party x4';
  if (sizes.includes('duo') && !sizes.includes('solo')) return 'Duo';
  if (sizes.includes('party4')) return 'Solo / Duo / Party x4';
  if (sizes.includes('duo')) return 'Solo / Duo';
  return 'Solo';
}

function boostLabel(percent: number, until?: number, now = Date.now()): string {
  if (!percent) return 'inativo';
  const left = until && until > now ? formatDuration(Math.floor((until - now) / 1000)) : '';
  return left ? `+${percent}%  ${left}` : `+${percent}%`;
}

function jewelryLabel(name?: string, left?: number): string {
  if (!name) return '–';
  if (left === undefined) return name;
  if (left > 200) return `${name} · ${Math.ceil(left / 4)}s`;
  return `${name} · ${left}`;
}

function topStacks(byItem: Record<number, number> | undefined, limit = 5): Array<[string, string]> {
  if (!byItem) return [];
  return Object.entries(byItem)
    .map(([id, count]) => ({ id: Number(id), count, name: itemsById.get(Number(id))?.name ?? `#${id}` }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)
    .map((entry) => [`${entry.name}`, formatNumber(entry.count)] as [string, string]);
}

function meleeSkill(character: CharacterView): { name: 'sword' | 'axe' | 'club'; level: number; tries: number } {
  const names = ['sword', 'axe', 'club'] as const;
  let best: { name: 'sword' | 'axe' | 'club'; level: number; tries: number } = { name: 'sword', level: 10, tries: 0 };
  for (const name of names) {
    const skill = character.skills[name];
    if (skill && skill.level >= best.level) best = { name, level: skill.level, tries: skill.tries };
  }
  return best;
}

function Analyzer({ id, title, rows }: { id: string; title: string; rows: Array<[string, string | number, string?]> }) {
  return (
    <DockBox id={id} title={title} extra={<span className="refresh">↺</span>} bodyClass="body kv">
      {rows.map(([label, value, tone]) => (
        <span key={label} style={{ display: 'contents' }}><span>{label}</span><strong className={tone}>{value}</strong></span>
      ))}
    </DockBox>
  );
}

function SkillsOverview({ character }: { character: CharacterView }) {
  const [selectedId, setSelectedId] = useState(character.id);
  const [view, setView] = useState<CharacterView>(character);
  const [loading, setLoading] = useState(false);

  const ids = character.partyMemberIds ?? [character.id];
  const tabs = ids.map((id) => {
    if (id === character.id) return { id, name: character.name };
    const mate = character.caveParty.find((entry) => entry.id === id);
    return { id, name: mate?.name ?? `#${id}` };
  });

  useEffect(() => {
    if (!ids.includes(selectedId)) {
      setSelectedId(character.id);
      setView(character);
      return;
    }
    if (selectedId === character.id) setView(character);
  }, [character, selectedId, ids.join(',')]);

  useEffect(() => {
    if (selectedId === character.id) return;
    let cancelled = false;
    const refresh = async () => {
      try {
        const result = await api.character(selectedId);
        if (!cancelled) setView(result.character);
      } catch { /* keep last valid snapshot */ }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 2500);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [selectedId, character.id]);

  const choose = async (id: number) => {
    if (id === selectedId) return;
    setSelectedId(id);
    if (id === character.id) { setView(character); return; }
    setLoading(true);
    try { const result = await api.character(id); setView(result.character); }
    finally { setLoading(false); }
  };

  const xp = xpProgress(view.level, view.experience);
  const melee = meleeSkill(view);
  const voc = view.vocation.id;
  const skills = [
    ['Magic', view.magicLevel, magicProgressPercent(voc, view.magicLevel, view.manaSpent ?? 0)],
    ['Fist', view.skills.fist?.level ?? 10, skillProgressPercent(voc, 'fist', view.skills.fist?.level ?? 10, view.skills.fist?.tries ?? 0)],
    ['Melee', melee.level, skillProgressPercent(voc, melee.name, melee.level, melee.tries)],
    ['Distance', view.skills.distance?.level ?? 10, skillProgressPercent(voc, 'distance', view.skills.distance?.level ?? 10, view.skills.distance?.tries ?? 0)],
    ['Shielding', view.skills.shield?.level ?? 10, skillProgressPercent(voc, 'shield', view.skills.shield?.level ?? 10, view.skills.shield?.tries ?? 0)],
  ] as const;

  const pct = (value: number) => `${(value * 100).toFixed(value * 100 >= 10 ? 0 : 2)}%`;
  const bonusRows: Array<[string, string]> = [
    ['Armadura', `+${formatNumber(view.stats.armor)}`],
    ['Defesa', `+${formatNumber(view.stats.defense)}`],
    ['Mitigação', `${view.stats.mitigation.toFixed(1)}%`],
    ['Chance de crítico', `+${pct(view.procs.critChance ?? 0)}`],
    ['Dano crítico', `+${pct(view.procs.critExtra ?? 0)}`],
    ['Life leech', `+${pct(view.procs.lifeLeech ?? 0)}`],
    ['Mana leech', `+${pct(view.procs.manaLeech ?? 0)}`],
    ['Dodge', `+${pct(view.procs.dodgeChance ?? 0)}`],
    ['Onslaught', `+${pct(view.procs.onslaughtChance ?? 0)}`],
    ['Magic Level bônus', `+${view.procs.magicLevel ?? 0}`],
    ['Ataque', formatNumber(view.stats.attackValue)],
    ['Dano / s', formatNumber(view.stats.damagePerSecond)],
  ];

  const equipped = Object.values(view.equipment ?? {});

  return (
    <DockBox id="skills" title="Skills">
      <div style={{ display:'flex', gap:4, overflowX:'auto', paddingBottom:7 }}>
        {tabs.map((tab) => <button key={tab.id} type="button" className={`btn ${tab.id===selectedId?'gold':''}`} disabled={loading} onClick={() => void choose(tab.id)} style={{ minWidth:0, padding:'3px 8px', fontSize:10, whiteSpace:'nowrap' }}>{tab.name}</button>)}
      </div>
      <div style={{ color:'#aaa', fontSize:11, margin:'0 0 7px' }}>{view.vocation.name}</div>

      <div className="kv" style={{ padding:'8px 10px', borderRadius:4, background:'rgba(0,0,0,.22)', marginBottom:9 }}>
        <span>Nível</span><strong>{view.level}</strong>
        <span>XP</span><strong>{formatNumber(view.experience)}</strong>
        <span>Pontos de Vida</span><strong>{formatNumber(view.health)} / {formatNumber(view.maxHealth)}</strong>
        <span>Mana</span><strong>{formatNumber(view.mana)} / {formatNumber(view.maxMana)}</strong>
        <span>Capacidade</span><strong>{formatNumber(view.stats.capacity)}</strong>
        <span>Tática</span><strong>nível {Math.floor((view.partyBonus ?? 0) / 5)} · {Math.round(view.partyBonus ?? 0)}%</strong>
      </div>

      <div style={{ display:'flex', justifyContent:'space-between', fontSize:11, marginBottom:3 }}><span>Experiência</span><strong>{Math.round(xp.percent)}%</strong></div>
      <div className="meter"><i style={{ width:`${xp.percent}%` }} /></div>

      <div style={{ marginTop:10, color:'#aaa', fontSize:10, letterSpacing:'.04em' }}>SKILLS (SOBEM POR USO — TREINE NO TREINO ONLINE)</div>
      <div style={{ marginTop:5 }}>
        {skills.map(([label, level, percent]) => (
          <div className="skillbar" key={label} title={`${Math.round(percent)}%`}><span>{label}</span><div className="track"><i style={{ width:`${percent}%` }} /></div><strong>{level}</strong></div>
        ))}
      </div>

      <div style={{ marginTop:11, color:'#aaa', fontSize:10, letterSpacing:'.04em' }}>BÔNUS (ITENS + BUILD + CODEX + BOOSTS)</div>
      <div className="kv" style={{ padding:'8px 10px', borderRadius:4, background:'rgba(0,0,0,.22)', marginTop:5 }}>
        {bonusRows.map(([label,value]) => <span key={label} style={{ display:'contents' }}><span>{label}</span><strong>{value}</strong></span>)}
      </div>

      <div style={{ marginTop:11, color:'#aaa', fontSize:10, letterSpacing:'.04em' }}>STATS DOS ITENS</div>
      <div style={{ marginTop:5, display:'grid', gap:5 }}>
        {equipped.length === 0 && <div className="soon">Nenhum item equipado.</div>}
        {equipped.map((item) => (
          <div key={item.id} style={{ display:'grid', gridTemplateColumns:'34px 1fr', gap:7, alignItems:'start', padding:'7px 8px', borderRadius:4, background:'rgba(0,0,0,.22)' }}>
            <ItemSlot itemId={item.id} compact label={item.name} />
            <div style={{ minWidth:0 }}><strong style={{ display:'block', marginBottom:4, color:'#eee' }}>{item.name}</strong>{itemTooltipLines(item.id).map((line) => <div key={line} style={{ color:'#aaa', fontSize:10, lineHeight:1.35 }}>{line}</div>)}</div>
          </div>
        ))}
      </div>
    </DockBox>
  );
}

export function LeftDock({ character, busy, onTaskRoll }: { character: CharacterView; busy?: boolean; onTaskRoll?: () => void }) {
  const [, setNow] = useState(() => Date.now());
  useEffect(() => { const id = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(id); }, []);
  const session = character.session;
  const staminaPct = Math.round((character.stamina / 2520) * 100);
  const staminaMul = staminaMultiplier(character.stamina, character.premium);
  const xp = xpProgress(character.level, character.experience);
  const xpLeft = Math.max(0, xp.next - character.experience);
  const profit = session?.rates.profitPerHour ?? 0;
  const hunt = session ? huntsById.get(session.huntId) : undefined;
  const need = hunt ? partyNeed(hunt.partySizes) : 0;
  const xpUntil = character.xpBoostUntil ?? 0;

  return (
    <aside className="dock">
      <DockBox id="stamina" title={`Stamina ${formatStamina(character.stamina)}`}>
        <div className="stamina-top"><span className={staminaTone(character.stamina)}>{formatStamina(character.stamina)}</span><strong>{staminaPct}%</strong></div>
        <div className="meter stamina"><i style={{ width:`${staminaPct}%` }} /></div>
        <div className="kv" style={{ marginTop:8 }}><span>XP</span><strong className={staminaMul>=1.5?'profit':staminaMul<1?'loss':''}>{staminaMul===0?'sem XP':`×${staminaMul}`}</strong><span>Loot</span><strong className={character.stamina>840?'':'loss'}>{character.stamina>840?'ativo':'sem loot'}</strong><span>Soul</span><strong>{character.soul ?? 0}/{character.soulMax ?? 100}</strong>{(character.vocation.id===9||character.vocation.id===10)&&<><span>Harmony</span><strong className={(character.harmony??0)>0?'profit':''}>{character.harmony??0}/5{character.virtueHarmony?' · virtue':''}</strong></>}</div>
      </DockBox>

      <DockBox id="task" title="Task">
        {character.task ? <div className="kv"><span>Alvo</span><strong>{monstersById.get(character.task.monsterId)?.name ?? character.task.monsterId}</strong><span>Progresso</span><strong className={character.task.claimed?'profit':''}>{character.task.progress}/{character.task.required}{character.task.claimed?' ✓':''}</strong><span>Recompensa</span><strong className="goldish">{formatNumber(character.task.gold)}g · {formatNumber(character.task.experience)} XP</strong></div> : <p className="soon" style={{margin:0}}>Entre numa hunt para receber uma task.</p>}
        {onTaskRoll && <button className="btn" style={{width:'100%',marginTop:8,fontSize:11}} disabled={busy} onClick={onTaskRoll}>{character.task&&!character.task.claimed?'Trocar · 500g':'Nova task'}</button>}
      </DockBox>

      <DockBox id="boosts" title="Boosts" bodyClass="body kv">
        <span>Boost de XP</span><strong className={character.boosts?.xp?'profit':'off'}>{boostLabel(character.boosts?.xp??0,xpUntil)}</strong><span>Boost de dano</span><strong className={character.boosts?.damage?'profit':'off'}>{boostLabel(character.boosts?.damage??0)}</strong><span>Boost de loot</span><strong className={character.boosts?.loot?'profit':'off'}>{boostLabel(character.boosts?.loot??0)}</strong><span>Boost de defesa</span><strong className={character.boosts?.defense?'profit':'off'}>{boostLabel(character.boosts?.defense??0)}</strong><span>Bênçãos</span><strong className={blessingCount(character.blessings??0)?'profit':'off'}>{blessingCount(character.blessings??0)}/5</strong>
      </DockBox>

      <SkillsOverview character={character} />

      <Analyzer id="hunt-analyzer" title="Hunt Analyzer" rows={[
        ['Session',formatDuration(session?.elapsedSeconds??0)],['XP/h',formatRate(session?.rates.xpPerHour??0)],['XP Stack',formatNumber(session?.totals.rawExperience??0)],['XP Gain',formatNumber(session?.totals.experience??0)],['Próx. nível',formatNumber(xpLeft)],['Kills',formatNumber(session?.totals.kills??0)],['Wave',session?`${session.packAlive??session.active.length}/${session.packSize}`:'–'],['Haste',session?.haste?'on':'–'],['Food',session?.fed?'on':'–'],['Utamo',session?.utamo?'on':'–'],['Avatar',session?.avatar?'on':'–'],['Summons',session?.summons?.length?`${session.summons.length}/2`:'–'],...(session&&(character.vocation.id===9||character.vocation.id===10)?[['Harmony',`${session.harmony??character.harmony??0}/5`,(session.harmony??0)>0?'profit':''] as [string,string,string]]:[]),...(session?.spellCooldowns?([['CDs',(['attack','wave','special','ultimate','support'] as const).filter((group)=>(session.spellCooldowns?.[group]??0)>0).map((group)=>`${group[0]!.toUpperCase()}${Math.ceil((session.spellCooldowns![group]??0)*0.25)}s`).join(' ')||'ready']] as Array<[string,string]>):[]),['Ring',jewelryLabel(session?.jewelry?.ring,session?.jewelry?.ringLeft)],['Amulet',jewelryLabel(session?.jewelry?.necklace,session?.jewelry?.necklaceLeft)],['Cap',session?`${formatNumber(session.capacityUsed??0)}/${formatNumber(session.capacityMax??character.stats.capacity)}`:formatNumber(character.stats.capacity)],['Loot',formatNumber(session?.totals.lootValue??0),'goldish'],['Supplies',formatNumber(session?.totals.supplyValue??0),'supply'],['Balance',formatRate(profit),profit>=0?'profit':'loss'],['Crits',formatNumber(session?.totals.crits??0)],['Fatals',formatNumber(session?.totals.fatals??0)],['Dodges',formatNumber(session?.totals.dodges??0)],['Misses',formatNumber(session?.totals.misses??0)],['Leech',formatNumber(session?.totals.leech??0)],['Combo',session?.totals.maxCombo?`x${session.totals.maxCombo}`:'–'],...(session?.boosted?[["Boosted",monstersById.get(session.boosted)?.name??session.boosted,'profit'] as [string,string,string]]:[])
      ]} />

      {!session && <DockBox id="dummy" title="Dummy de exercício" bodyClass="body kv"><span>Skill</span><strong>{character.dummySkill}</strong><span>Cargas</span><strong className={(character.exerciseCharges??0)>0?'profit':''}>{formatNumber(character.exerciseCharges??0)}</strong><span>Ritmo</span><strong>1 try / 8s</strong><span>Teto</span><strong>8h · 450/h</strong><span>Última</span><strong>{character.lastDummyTries?`${formatNumber(character.lastDummyTries)} tries`:'—'}</strong></DockBox>}

      <DockBox id="party-hunt" title="Party Hunt" bodyClass="body kv"><span>Hunt</span><strong>{hunt?.name??'—'}</strong><span>Tamanho</span><strong>{hunt?partyLabel(hunt.partySizes):'—'}</strong><span>Precisa</span><strong className={need>character.partySlots?'loss':''}>{need?`${need} slot${need>1?'s':''}`:'—'}</strong><span>Slots</span><strong>{character.partySlots}/3</strong><span>Bônus party</span><strong className={character.partyBonus>0?'profit':'off'}>{character.partyBonus>0?`+${character.partyBonus}%`:'–'}</strong><span>Bônus guild</span><strong className={character.guildId?'profit':'off'}>{character.guildId?'+3%':'–'}</strong>{(character.caveParty??[]).map((mate)=><span key={`${mate.id}-${mate.name}`} style={{display:'contents'}}><span>{mate.self?'Você':mate.name}</span><strong>lvl {mate.level}</strong></span>)}</DockBox>

      <Analyzer id="damage" title="Damage" rows={[["Session",formatDuration(session?.elapsedSeconds??0)],["Total",formatNumber(session?.totals.damageDealt??0)],["Per hour",formatRate(session?.rates.damagePerHour??0)]]} />
      <Analyzer id="damage-taken" title="Damage Taken" rows={[["Session",formatDuration(session?.elapsedSeconds??0)],["Total",formatNumber(session?.totals.damageTaken??0)]]} />
      <Analyzer id="loot-analyser" title="Loot Analyser" rows={[["Session",formatDuration(session?.elapsedSeconds??0)],["Gold value",formatNumber(session?.totals.lootValue??0),'goldish'],["Per hour",formatRate(session?.rates.lootPerHour??0),'goldish'],...topStacks(session?.totals.lootByItem)]} />
      <Analyzer id="supply-analyser" title="Supply Analyser" rows={[["Session",formatDuration(session?.elapsedSeconds??0)],["Gold value",formatNumber(session?.totals.supplyValue??0),'supply'],["Per hour",formatRate(session?.rates.suppliesPerHour??0),'supply'],...topStacks(session?.totals.suppliesByItem)]} />
    </aside>
  );
}
