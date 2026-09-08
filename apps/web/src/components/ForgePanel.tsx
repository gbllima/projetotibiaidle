import { useState } from 'react';
import { monstersById } from '@tibia-idle/data';
import {
  EXALT_TIER_CAP,
  FORGE_BASE_SUCCESS_RATE,
  FORGE_BONUS_SUCCESS_RATE,
  FORGE_CLASS4_TIERS,
  FORGE_CONVERGENCE_FUSION_DUST_COST,
  FORGE_CONVERGENCE_TRANSFER_DUST_COST,
  FORGE_DUST_LEVEL_MAX,
  FORGE_DUST_PER_SLIVER_PACK,
  FORGE_SLIVERS_PER_CORE,
  FORGE_SLIVERS_PER_PACK,
  FORGE_TRANSFER_DUST_COST,
  exaltCost,
  exaltDustCost,
  forgeDustCapCost,
  forgeFusionSuccessChance,
  forgeTierPrice,
} from '@tibia-idle/sim';
import type { CharacterView } from '../api/types.js';
import { formatNumber } from '../format.js';

export function ForgePanel({
  character,
  busy,
  onAct,
}: {
  character: CharacterView;
  busy: boolean;
  onAct: (body: Record<string, unknown>) => Promise<Record<string, unknown>>;
}) {
  const [monsterId, setMonsterId] = useState(Object.keys(character.bestiary)[0] ?? 'rat');
  const [mode, setMode] = useState<'fusion' | 'transfer' | 'convergence'>('fusion');
  const [useCore, setUseCore] = useState(false);
  const [reduceTierLoss, setReduceTierLoss] = useState(false);
  const [donorSlot, setDonorSlot] = useState('');
  const [receiveSlot, setReceiveSlot] = useState('');
  const influence = character.forge[monsterId] ?? 0;
  const worn = Object.entries(character.equipment);
  const dust = character.forgeDust ?? 0;
  const dustCap = character.forgeDustLevel ?? 100;
  const slivers = character.forgeSlivers ?? 0;
  const cores = character.forgeCores ?? 0;
  const dustNeeded = exaltDustCost(0);
  const capCost = forgeDustCapCost(dustCap);
  const coresNeeded = (useCore ? 1 : 0) + (reduceTierLoss ? 1 : 0);
  const successChance = forgeFusionSuccessChance(useCore);
  const slotOptions = worn.map(([slot]) => slot);
  const donor = donorSlot || slotOptions[0] || '';
  const receiver = receiveSlot || slotOptions.find((slot) => slot !== donor) || '';
  const tierOf = (slot: string) => character.equipmentTiers[slot] ?? 0;
  const donorClass = donor ? tierOf(donor) : 0;
  const receiveClass = receiver ? tierOf(receiver) : 0;
  const transferToTier = mode === 'convergence' ? donorClass : Math.max(0, donorClass - 1);
  const transferPrice = transferToTier >= 1 ? forgeTierPrice(transferToTier) : null;
  const transferDust = mode === 'convergence' ? FORGE_CONVERGENCE_TRANSFER_DUST_COST : FORGE_TRANSFER_DUST_COST;
  const transferGold = transferPrice
    ? (mode === 'convergence' ? transferPrice.convergenceTransfer : transferPrice.regular)
    : 0;
  const transferCores = transferPrice?.cores ?? 0;

  return (
    <div className="forge-panel">
      <h3>Exaltação</h3>
      <p className="meta" style={{ marginBottom: 8 }}>
        Poeira: <b className={dust >= dustNeeded ? 'profit' : 'loss'}>{formatNumber(dust)}</b> / {dustCap}
        {' · '}Slivers: <b>{formatNumber(slivers)}</b>
        {' · '}Cores: <b>{formatNumber(cores)}</b>
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
        {dustCap < FORGE_DUST_LEVEL_MAX && (
          <button className="btn" disabled={busy || character.gold < capCost} onClick={() => void onAct({ type: 'forge-dust-cap' })}>
            +1 teto · {formatNumber(capCost)}g
          </button>
        )}
        <button
          className="btn"
          disabled={busy || dust < FORGE_DUST_PER_SLIVER_PACK}
          onClick={() => void onAct({ type: 'forge-dust-slivers', packs: 1 })}
        >
          {FORGE_DUST_PER_SLIVER_PACK} poeira → {FORGE_SLIVERS_PER_PACK} slivers
        </button>
        <button
          className="btn"
          disabled={busy || slivers < FORGE_SLIVERS_PER_CORE}
          onClick={() => void onAct({ type: 'forge-slivers-core', cores: 1 })}
        >
          {FORGE_SLIVERS_PER_CORE} slivers → 1 core
        </button>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
        {([
          ['fusion', 'Fusão'],
          ['transfer', 'Transfer'],
          ['convergence', 'Convergence'],
        ] as const).map(([id, label]) => (
          <button
            key={id}
            className={`btn ${mode === id ? 'gold' : ''}`}
            disabled={busy}
            onClick={() => setMode(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {mode === 'fusion' && (
        <>
          <p className="lede" style={{ textAlign: 'left' }}>
            Classification 0–{EXALT_TIER_CAP}. Fusão Crystal: {FORGE_BASE_SUCCESS_RATE}% base
            {useCore ? ` + ${FORGE_BONUS_SUCCESS_RATE}% = ${successChance}%` : ` (core +${FORGE_BONUS_SUCCESS_RATE}%)`}.
            Cada tentativa: {dustNeeded} poeira + gold idle. Falha pode baixar 1 tier.
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginBottom: 12 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input type="checkbox" checked={useCore} disabled={busy || cores < 1} onChange={(event) => setUseCore(event.target.checked)} />
              Core de sucesso (+{FORGE_BONUS_SUCCESS_RATE}%)
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input
                type="checkbox"
                checked={reduceTierLoss}
                disabled={busy || cores < (useCore ? 2 : 1)}
                onChange={(event) => setReduceTierLoss(event.target.checked)}
              />
              Core anti-perda (50% manter tier)
            </label>
          </div>
          {worn.length === 0 && <p className="soon">Vista um item no paperdoll para exaltar.</p>}
          {worn.map(([slot, item]) => {
            const tier = tierOf(slot);
            const cost = exaltCost(tier);
            const can = tier < EXALT_TIER_CAP
              && character.gold >= cost
              && dust >= dustNeeded
              && cores >= coresNeeded;
            return (
              <div className="hunt-row" key={slot}>
                <div>
                  {item.name}
                  <div className="meta">{slot} · class {tier} · {successChance}% sucesso</div>
                </div>
                <button
                  className="btn gold"
                  disabled={busy || !can}
                  onClick={() => void onAct({ type: 'exalt', slot, useCore, reduceTierLoss })}
                >
                  Fundir · {dustNeeded} poeira
                  {coresNeeded > 0 ? ` + ${coresNeeded} core` : ''}
                  {' + '}{formatNumber(cost)}g
                </button>
              </div>
            );
          })}
        </>
      )}

      {mode === 'transfer' && (
        <>
          <p className="lede" style={{ textAlign: 'left' }}>
            Move classification entre dois slots vestidos. Normal: receptor (class 0) recebe donor−1;
            donor zera. Custo Crystal class-4: {FORGE_TRANSFER_DUST_COST} poeira + gold + cores.
          </p>
          {worn.length < 2 ? (
            <p className="soon">Vista ao menos dois itens para transferir.</p>
          ) : (
            <>
              <label>Doador</label>
              <select value={donor} onChange={(event) => setDonorSlot(event.target.value)}>
                {slotOptions.map((slot) => (
                  <option key={slot} value={slot}>{slot} · class {tierOf(slot)}</option>
                ))}
              </select>
              <label>Receptor</label>
              <select value={receiver} onChange={(event) => setReceiveSlot(event.target.value)}>
                {slotOptions.filter((slot) => slot !== donor).map((slot) => (
                  <option key={slot} value={slot}>{slot} · class {tierOf(slot)}</option>
                ))}
              </select>
              <p className="meta">
                Resultado: receptor → class {transferToTier || '—'}
                {transferPrice ? ` · ${transferDust} poeira · ${transferCores} cores · ${formatNumber(transferGold)}g` : ''}
              </p>
              <button
                className="btn gold"
                disabled={
                  busy
                  || !donor
                  || !receiver
                  || donor === receiver
                  || receiveClass !== 0
                  || donorClass < 2
                  || !transferPrice
                  || dust < transferDust
                  || cores < transferCores
                  || character.gold < transferGold
                }
                onClick={() => void onAct({ type: 'forge-transfer', donorSlot: donor, receiveSlot: receiver, convergence: false })}
              >
                Transferir · {transferDust} poeira + {transferCores} cores + {formatNumber(transferGold)}g
              </button>
            </>
          )}
        </>
      )}

      {mode === 'convergence' && (
        <>
          <p className="lede" style={{ textAlign: 'left' }}>
            Convergence Fusion: +1 garantido ({FORGE_CONVERGENCE_FUSION_DUST_COST} poeira + gold class-4).
            Convergence Transfer: move o tier inteiro ({FORGE_CONVERGENCE_TRANSFER_DUST_COST} poeira).
          </p>
          <h4>Fusion garantida</h4>
          {worn.map(([slot, item]) => {
            const tier = tierOf(slot);
            const price = forgeTierPrice(tier + 1);
            const cost = price?.convergenceFusion ?? 0;
            const can = tier < EXALT_TIER_CAP
              && price
              && dust >= FORGE_CONVERGENCE_FUSION_DUST_COST
              && character.gold >= cost;
            return (
              <div className="hunt-row" key={`conv-${slot}`}>
                <div>
                  {item.name}
                  <div className="meta">{slot} · class {tier} → {tier + 1} · {FORGE_CONVERGENCE_FUSION_DUST_COST} poeira</div>
                </div>
                <button
                  className="btn gold"
                  disabled={busy || !can}
                  onClick={() => void onAct({ type: 'forge-convergence-fusion', slot })}
                >
                  Convergence · {formatNumber(cost)}g
                </button>
              </div>
            );
          })}
          <h4 style={{ marginTop: 12 }}>Transfer completo</h4>
          {worn.length < 2 ? (
            <p className="soon">Vista ao menos dois itens.</p>
          ) : (
            <>
              <label>Doador</label>
              <select value={donor} onChange={(event) => setDonorSlot(event.target.value)}>
                {slotOptions.map((slot) => (
                  <option key={`d-${slot}`} value={slot}>{slot} · class {tierOf(slot)}</option>
                ))}
              </select>
              <label>Receptor</label>
              <select value={receiver} onChange={(event) => setReceiveSlot(event.target.value)}>
                {slotOptions.filter((slot) => slot !== donor).map((slot) => (
                  <option key={`r-${slot}`} value={slot}>{slot} · class {tierOf(slot)}</option>
                ))}
              </select>
              <p className="meta">
                Receptor → class {donorClass || '—'}
                {transferPrice ? ` · ${FORGE_CONVERGENCE_TRANSFER_DUST_COST} poeira · ${transferCores} cores · ${formatNumber(transferPrice.convergenceTransfer)}g` : ''}
              </p>
              <button
                className="btn gold"
                disabled={
                  busy
                  || !donor
                  || !receiver
                  || donor === receiver
                  || receiveClass !== 0
                  || donorClass < 1
                  || !transferPrice
                  || dust < FORGE_CONVERGENCE_TRANSFER_DUST_COST
                  || cores < transferCores
                  || character.gold < (transferPrice?.convergenceTransfer ?? 0)
                }
                onClick={() => void onAct({ type: 'forge-transfer', donorSlot: donor, receiveSlot: receiver, convergence: true })}
              >
                Convergence transfer · {formatNumber(transferPrice?.convergenceTransfer ?? 0)}g
              </button>
            </>
          )}
          <p className="meta" style={{ marginTop: 8 }}>
            Tabela class-4 (tier 1): {formatNumber(FORGE_CLASS4_TIERS[1]!.regular)}g regular /
            {' '}{formatNumber(FORGE_CLASS4_TIERS[1]!.convergenceFusion)}g conv. fusion.
          </p>
        </>
      )}

      <h3 style={{ marginTop: 16 }}>Influência de espécie</h3>
      <p className="lede" style={{ textAlign: 'left' }}>Aumenta XP e loot contra aquela criatura. +5 por forja, até 100. Também melhora um pouco a chance de poeira.</p>
      <select value={monsterId} onChange={(event) => setMonsterId(event.target.value)}>
        {Object.keys(character.bestiary).concat(['rat', 'troll', 'rotworm']).filter((id, index, all) => all.indexOf(id) === index && monstersById.has(id)).map((id) => (
          <option key={id} value={id}>{monstersById.get(id)?.name} · {character.forge[id] ?? 0}</option>
        ))}
      </select>
      <p>Influência atual: <b>{influence}</b> · custo {formatNumber(2000 * (influence + 1))} gold</p>
      <button className="btn gold" disabled={busy} onClick={() => void onAct({ type: 'forge', monsterId })}>Forjar +5</button>
    </div>
  );
}
