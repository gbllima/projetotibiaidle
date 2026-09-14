import {
  addManaSpent,
  deriveStats,
  isBossHunt,
  TICK_MS,
  type HuntPolicy,
  type HuntSession,
  type SimEvent,
} from '@tibia-idle/sim';

const CONFIG_PREFIX = '__partyheal:';
const HEAL_FRIEND_LEVEL = 18;
const HEAL_FRIEND_MANA = 120;
const HEAL_FRIEND_COOLDOWN_TICKS = Math.max(1, Math.round(1000 / TICK_MS));

type BaseVocation = 1 | 2 | 3 | 4 | 9;

export interface PartyHealSettings {
  enabled: boolean;
  selfFirst: boolean;
  priority: Record<BaseVocation, number>;
  threshold: Record<BaseVocation, number>;
}

export interface PartyHealEntry {
  id: number;
  session: HuntSession;
  cursor: number;
  until: number;
}

export interface PartyHealEvent {
  healerId: number;
  event: SimEvent;
}

const DEFAULT_PRIORITY: Record<BaseVocation, number> = {
  4: 1,
  9: 1,
  3: 2,
  2: 3,
  1: 3,
};

const DEFAULT_THRESHOLD: Record<BaseVocation, number> = {
  4: 0.9,
  9: 0.9,
  3: 0.9,
  2: 0.9,
  1: 0.9,
};

function baseVocation(vocationId: number): BaseVocation {
  if (vocationId === 5) return 1;
  if (vocationId === 6) return 2;
  if (vocationId === 7) return 3;
  if (vocationId === 8) return 4;
  if (vocationId === 10) return 9;
  return ([1, 2, 3, 4, 9] as number[]).includes(vocationId) ? vocationId as BaseVocation : 1;
}

function combatPolicy(session: HuntSession): HuntPolicy {
  if (isBossHunt(session.huntId)) {
    return session.character.helperProfiles?.boss ?? session.character.policy;
  }
  return session.character.policy;
}

export function parsePartyHealSettings(policy: Pick<HuntPolicy, 'disabledSpells'>): PartyHealSettings {
  const tokens = policy.disabledSpells ?? [];
  const configured = tokens.some((token) => token.startsWith(CONFIG_PREFIX));
  const settings: PartyHealSettings = {
    enabled: configured ? tokens.includes(`${CONFIG_PREFIX}on`) : false,
    selfFirst: configured ? tokens.includes(`${CONFIG_PREFIX}self`) : true,
    priority: { ...DEFAULT_PRIORITY },
    threshold: { ...DEFAULT_THRESHOLD },
  };

  for (const token of tokens) {
    if (!token.startsWith(CONFIG_PREFIX)) continue;
    const payload = token.slice(CONFIG_PREFIX.length);
    const priority = /^p:(1|2|3|4|9)=(1|2|3)$/.exec(payload);
    if (priority) {
      settings.priority[Number(priority[1]) as BaseVocation] = Number(priority[2]);
      continue;
    }
    const threshold = /^t:(1|2|3|4|9)=(\d{1,3})$/.exec(payload);
    if (threshold) {
      const value = Math.max(20, Math.min(95, Number(threshold[2]))) / 100;
      settings.threshold[Number(threshold[1]) as BaseVocation] = value;
    }
  }
  return settings;
}

function healAmount(session: HuntSession): number {
  const character = session.character;
  // Deterministic average for Heal Friend. Keeping this deterministic is
  // important because party/offline settlement must not depend on request chunking.
  return Math.max(1, Math.round(80 + character.level * 1.5 + character.magicLevel * 10));
}

/**
 * Executes Druid/Elder Druid Heal Friend before the normal per-character tick.
 * That ordering lets "Priorizar minha cura" work correctly: when enabled and
 * the healer is below its own healing trigger, exura sio waits and the regular
 * self-heal in combat gets the shared healing cooldown first.
 */
export function applyPartyHealing(entries: PartyHealEntry[], next: number): PartyHealEvent[] {
  const events: PartyHealEvent[] = [];

  for (const healer of entries) {
    const session = healer.session;
    const character = session.character;
    if (session.status !== 'active' || healer.cursor + TICK_MS !== next || next > healer.until) continue;
    if (baseVocation(character.vocationId) !== 2 || character.level < HEAL_FRIEND_LEVEL) continue;
    if ((session.healCooldownTicks ?? 0) > 0 || character.mana < HEAL_FRIEND_MANA) continue;

    const policy = combatPolicy(session);
    const settings = parsePartyHealSettings(policy);
    if (!settings.enabled) continue;

    if (settings.selfFirst) {
      const ownStats = deriveStats(character);
      const ownTrigger = Math.max(policy.healSpellAt ?? 0.7, policy.healthPotionAt ?? 0.6);
      if (character.health / Math.max(1, ownStats.maxHealth) < ownTrigger) continue;
    }

    const candidates = entries
      .filter((target) => target.id !== healer.id
        && target.session.huntId === session.huntId
        && target.session.status === 'active'
        && target.session.character.health > 0
        && target.cursor + TICK_MS === next
        && next <= target.until)
      .map((target) => {
        const vocation = baseVocation(target.session.character.vocationId);
        const stats = deriveStats(target.session.character);
        const healthRatio = target.session.character.health / Math.max(1, stats.maxHealth);
        return {
          target,
          vocation,
          stats,
          healthRatio,
          priority: settings.priority[vocation],
          threshold: settings.threshold[vocation],
        };
      })
      .filter((candidate) => candidate.healthRatio < candidate.threshold)
      .sort((left, right) => {
        if (left.priority !== right.priority) return left.priority - right.priority;
        if (left.healthRatio !== right.healthRatio) return left.healthRatio - right.healthRatio;
        return left.target.id - right.target.id;
      });

    const chosen = candidates[0];
    if (!chosen) continue;

    const amount = Math.min(
      healAmount(session),
      Math.max(0, chosen.stats.maxHealth - chosen.target.session.character.health),
    );
    if (amount <= 0) continue;

    character.mana -= HEAL_FRIEND_MANA;
    addManaSpent(character, HEAL_FRIEND_MANA, 1);
    chosen.target.session.character.health += amount;
    session.totals.healingDone += amount;
    session.healCooldownTicks = HEAL_FRIEND_COOLDOWN_TICKS;

    events.push({
      healerId: healer.id,
      event: {
        tick: session.tick + 1,
        type: 'heal',
        actorId: healer.id,
        amount,
        words: 'exura sio',
      },
    });
  }

  return events;
}
