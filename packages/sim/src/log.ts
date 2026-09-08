import { itemsById, monstersById } from '@tibia-idle/data';
import { HEALTH_POTION_TIERS, MANA_POTION_TIERS, SPIRIT_POTION_TIERS } from './supplies.js';
import type { SimEvent } from './types.js';

export type CombatLogKind = 'sys' | 'say' | 'hit' | 'hurt' | 'heal' | 'loot';
export type CombatLogLocale = 'pt' | 'en';

export interface CombatLogLine {
  kind: CombatLogKind;
  text: string;
}

/** Tibia-style Default channel lines for a tick of simulation events. */
export function formatCombatLog(events: SimEvent[], locale: CombatLogLocale = 'en'): CombatLogLine[] {
  const lines: CombatLogLine[] = [];
  for (const event of events) {
    switch (event.type) {
      case 'player_attack': {
        if (event.words) lines.push({ kind: 'say', text: locale === 'pt' ? `Você diz: ${event.words}` : `You say: ${event.words}` });
        if (event.uid === undefined) break;
        const target = creature(event.monsterId, locale);
        if (event.missed) {
          lines.push({
            kind: 'hit',
            text: locale === 'pt' ? `Seu tiro errou ${target}.` : `Your shot missed ${target}.`,
          });
        } else if (event.blocked) {
          lines.push({ kind: 'hit', text: locale === 'pt' ? `${cap(target)} não é afetado.` : `${cap(target)} is not affected.` });
        } else if ((event.amount ?? 0) > 0) {
          const amount = Math.round(event.amount ?? 0);
          const fatal = event.fatal ? (locale === 'pt' ? ' fatal' : ' fatal') : '';
          lines.push({
            kind: 'hit',
            text: locale === 'pt'
              ? `${cap(target)} perde ${amount} pontos de vida devido ao seu ataque${event.critical ? ' crítico' : ''}${fatal}.`
              : `${cap(target)} loses ${amount} hitpoints due to your${event.critical ? ' critical' : ''}${fatal} attack.`,
          });
        }
        break;
      }
      case 'monster_attack': {
        const source = creature(event.monsterId, locale);
        if (event.skill === 'paralyze') {
          lines.push({
            kind: 'hurt',
            text: locale === 'pt'
              ? `${cap(source)} te paralisa.`
              : `${cap(source)} paralyzes you.`,
          });
        } else if (event.dodged) {
          lines.push({ kind: 'hurt', text: locale === 'pt' ? `Você desviou de um ataque de ${source}.` : `You dodged an attack by ${source}.` });
        } else if (event.blocked) {
          lines.push({ kind: 'hurt', text: locale === 'pt' ? `O ataque de ${source} não teve efeito.` : `${cap(source)}'s attack had no effect.` });
        } else if ((event.amount ?? 0) > 0) {
          const amount = Math.round(event.amount ?? 0);
          lines.push({
            kind: 'hurt',
            text: locale === 'pt'
              ? `Você perde ${amount} pontos de vida devido a um ataque de ${source}.`
              : `You lose ${amount} hitpoints due to an attack by ${source}.`,
          });
        }
        break;
      }
      case 'heal': {
        if (event.words) lines.push({ kind: 'say', text: locale === 'pt' ? `Você diz: ${event.words}` : `You say: ${event.words}` });
        if ((event.amount ?? 0) > 0) {
          const amount = Math.round(event.amount ?? 0);
          lines.push({
            kind: 'heal',
            text: locale === 'pt' ? `Você se curou em ${amount} pontos de vida.` : `You healed yourself for ${amount} hitpoints.`,
          });
        }
        break;
      }
      case 'potion': {
        const amount = Math.round(event.amount ?? 0);
        if (amount <= 0) break;
        const itemId = event.itemId ?? 0;
        const isMana = MANA_POTION_TIERS.some((tier) => tier.itemId === itemId);
        const isSpirit = SPIRIT_POTION_TIERS.some((tier) => tier.itemId === itemId);
        const isHealth = HEALTH_POTION_TIERS.some((tier) => tier.itemId === itemId);
        if (isMana) {
          lines.push({
            kind: 'heal',
            text: locale === 'pt'
              ? `Você recuperou ${amount} pontos de mana.`
              : `You recovered ${amount} mana.`,
          });
        } else if (isSpirit) {
          lines.push({
            kind: 'heal',
            text: locale === 'pt'
              ? `Você bebeu uma spirit potion (+${amount}).`
              : `You drank a spirit potion (+${amount}).`,
          });
        } else if (isHealth) {
          lines.push({
            kind: 'heal',
            text: locale === 'pt'
              ? `Você se curou em ${amount} pontos de vida.`
              : `You healed yourself for ${amount} hitpoints.`,
          });
        }
        break;
      }
      case 'loot': {
        const item = itemsById.get(event.itemId ?? 0)?.name ?? (locale === 'pt' ? 'item' : 'item');
        const count = event.count && event.count > 1 ? `${event.count} ` : '';
        lines.push({ kind: 'loot', text: locale === 'pt' ? `Saqueou ${count}${item}.` : `Looted ${count}${item}.` });
        break;
      }
      case 'monster_death': {
        lines.push({
          kind: 'sys',
          text: locale === 'pt' ? `${cap(creature(event.monsterId, locale))} morreu.` : `${cap(creature(event.monsterId, locale))} has died.`,
        });
        break;
      }
      case 'forge_dust': {
        const amount = event.amount ?? 0;
        const slivers = event.count ?? 0;
        const kind = event.words === 'fiendish' ? 'fiendish' : 'influenced';
        const extra = slivers > 0
          ? (locale === 'pt' ? ` · +${slivers} slivers` : ` · +${slivers} slivers`)
          : '';
        lines.push({
          kind: 'loot',
          text: locale === 'pt'
            ? `Poeira de forja (+${amount})${extra} · ${kind}.`
            : `Forge dust (+${amount})${extra} · ${kind}.`,
        });
        break;
      }
      case 'level_up': {
        if (event.level) {
          lines.push({
            kind: 'sys',
            text: locale === 'pt' ? `Você avançou para o nível ${event.level}.` : `You advanced to level ${event.level}.`,
          });
        }
        break;
      }
      case 'task_complete': {
        const gold = event.amount ? event.amount.toLocaleString(locale === 'pt' ? 'pt-BR' : 'en-US') : '0';
        lines.push({
          kind: 'sys',
          text: locale === 'pt'
            ? `Task concluída! +${gold} gold e bônus de XP.`
            : `Task complete! +${gold} gold and bonus XP.`,
        });
        break;
      }
      case 'player_death':
        lines.push({
          kind: 'hurt',
          text: locale === 'pt'
            ? `Você morreu.${event.amount ? ` Perdeu ${event.amount.toLocaleString('pt-BR')} XP.` : ''}${event.skill ? ` ${event.skill} skill(s) perdida(s).` : ''}${event.level ? ` ${event.level} bênção(ões) consumida(s).` : ''}`
            : `You are dead.${event.amount ? ` Lost ${event.amount.toLocaleString('en-US')} XP.` : ''}${event.skill ? ` ${event.skill} skill level(s) lost.` : ''}${event.level ? ` ${event.level} blessing(s) consumed.` : ''}`,
        });
        break;
      case 'fled':
        lines.push({ kind: 'sys', text: locale === 'pt' ? 'Você fugiu da hunt.' : 'You fled the hunt.' });
        break;
      case 'condition': {
        const amount = Math.round(event.amount ?? 0);
        if (amount > 0) {
          const name = event.skill ?? (locale === 'pt' ? 'uma condição' : 'a condition');
          lines.push({
            kind: 'hurt',
            text: locale === 'pt'
              ? `Você perde ${amount} pontos de vida por ${name}.`
              : `You lose ${amount} hitpoints due to ${name}.`,
          });
        }
        break;
      }
      case 'buff': {
        if (event.words === 'vibrancy') {
          lines.push({
            kind: 'sys',
            text: locale === 'pt'
              ? 'Vibrancy deflete o efeito de paralyze.'
              : 'Vibrancy deflects the paralyze effect.',
          });
        } else if (event.words === 'transcendence') {
          lines.push({
            kind: 'sys',
            text: locale === 'pt'
              ? 'Transcendence foi ativado.'
              : 'Transcendence was triggered.',
          });
        } else if (event.words) {
          lines.push({ kind: 'say', text: locale === 'pt' ? `Você diz: ${event.words}` : `You say: ${event.words}` });
        } else if (event.itemId) {
          const item = itemsById.get(event.itemId)?.name ?? (locale === 'pt' ? 'comida' : 'food');
          lines.push({
            kind: 'heal',
            text: locale === 'pt' ? `Você come ${item}.` : `You eat ${item}.`,
          });
        }
        break;
      }
      case 'out_of_supplies':
        lines.push({ kind: 'sys', text: locale === 'pt' ? 'Você está sem supplies.' : 'You are out of supplies.' });
        break;
      case 'stamina_depleted':
        lines.push({ kind: 'sys', text: locale === 'pt' ? 'Sua stamina acabou.' : 'Your stamina is depleted.' });
        break;
      case 'boss_cleared': {
        const name = monstersById.get(event.monsterId ?? '')?.name ?? (locale === 'pt' ? 'boss' : 'boss');
        lines.push({
          kind: 'sys',
          text: locale === 'pt' ? `${name} derrotado! Cooldown de 20 horas.` : `${name} defeated! 20-hour cooldown.`,
        });
        break;
      }
      default:
        break;
    }
  }
  return lines;
}

function creature(monsterId: string | undefined, locale: CombatLogLocale): string {
  const name = monstersById.get(monsterId ?? '')?.name ?? (locale === 'pt' ? 'monstro' : 'monster');
  if (locale === 'pt') return `um ${name}`;
  return /^[aeiou]/i.test(name) ? `an ${name}` : `a ${name}`;
}

function cap(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
