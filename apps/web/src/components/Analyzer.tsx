import type { CharacterView } from '../api/types.js';
import { formatDuration, formatNumber, formatRate } from '../format.js';

export function Analyzer({ character }: { character: CharacterView }) {
  const session = character.session;
  if (!session) {
    return (
      <aside className="panel right">
        <h3>Hunt Analyzer</h3>
        <p className="lede" style={{ textAlign: 'left' }}>
          Entre numa hunt para ver XP/h, loot, supplies e o Balance.
        </p>
      </aside>
    );
  }

  const profit = session.rates.profitPerHour;
  return (
    <aside className="panel right">
      <h3>Hunt Analyzer</h3>
      <div className="kv" style={{ marginTop: 12 }}>
        <span>Sessão</span>
        <strong>{formatDuration(session.elapsedSeconds)}</strong>
        <span>XP / h</span>
        <strong>{formatRate(session.rates.xpPerHour)}</strong>
        <span>XP ganho</span>
        <strong>{formatNumber(session.totals.experience)}</strong>
        <span>Kills</span>
        <strong>{formatNumber(session.totals.kills)}</strong>
        <span>Dano / h</span>
        <strong>{formatRate(session.rates.damagePerHour)}</strong>
      </div>

      <h3 style={{ marginTop: 22 }}>Loot Analyser</h3>
      <div className="kv" style={{ marginTop: 12 }}>
        <span>Gold</span>
        <strong>{formatNumber(session.totals.lootValue)}</strong>
        <span>Por hora</span>
        <strong>{formatRate(session.rates.lootPerHour)}</strong>
      </div>

      <h3 style={{ marginTop: 22 }}>Supply Analyser</h3>
      <div className="kv" style={{ marginTop: 12 }}>
        <span>Gasto</span>
        <strong>{formatNumber(session.totals.supplyValue)}</strong>
        <span>Poções</span>
        <strong>{formatNumber(session.totals.potionsUsed)}</strong>
        <span>Por hora</span>
        <strong>{formatRate(session.rates.suppliesPerHour)}</strong>
        <span>Balance</span>
        <strong className={profit >= 0 ? 'profit' : 'loss'}>{formatRate(profit)}</strong>
      </div>

      <h3 style={{ marginTop: 22 }}>Combat Procs</h3>
      <div className="kv" style={{ marginTop: 12 }}>
        <span>Críticos</span>
        <strong>{formatNumber(session.totals.crits ?? 0)}</strong>
        <span>Fatais</span>
        <strong>{formatNumber(session.totals.fatals ?? 0)}</strong>
        <span>Dodges</span>
        <strong>{formatNumber(session.totals.dodges ?? 0)}</strong>
        <span>Misses</span>
        <strong>{formatNumber(session.totals.misses ?? 0)}</strong>
        <span>Leech</span>
        <strong>{formatNumber(session.totals.leech ?? 0)}</strong>
        <span>Combo máx</span>
        <strong>{session.totals.maxCombo ? `×${session.totals.maxCombo}` : '–'}</strong>
      </div>

      {character.supplies.length > 0 && (
        <>
          <h3 style={{ marginTop: 22 }}>Supplies</h3>
          <div className="kv" style={{ marginTop: 12 }}>
            {character.supplies.map((stack) => (
              <span key={stack.itemId} style={{ gridColumn: '1 / -1' }}>
                {stack.name} × {formatNumber(stack.count)}
              </span>
            ))}
          </div>
        </>
      )}
    </aside>
  );
}
