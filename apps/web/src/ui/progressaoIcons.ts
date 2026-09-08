export type ProgressaoMenuId = 'imbuement' | 'prey' | 'wheel' | 'task' | 'forge';

export type ProgressaoView = ProgressaoMenuId | 'hub';

/** Top-nav Progressão hub — official progression analyser widget. */
export const PROGRESSAO_NAV_ICON = 'icons/icon-progressanalyser-widget';

export const PROGRESSAO_MENU: Array<{
  id: ProgressaoMenuId;
  label: string;
  hint: string;
  icon: string;
  tone: string;
}> = [
  {
    id: 'imbuement',
    label: 'Imbuements',
    hint: 'Shrine Crystal · 24 tipos · 20h',
    icon: 'icons/icon-imbuementtracker-widget',
    tone: '#0f766e',
  },
  {
    id: 'prey',
    label: 'Prey',
    hint: 'Bônus contra criaturas · 2h',
    icon: 'icons/icon-preydialogue',
    tone: '#15803d',
  },
  {
    id: 'wheel',
    label: 'Wheel of Destiny',
    hint: 'Roda de habilidade · lvl 50+',
    icon: 'game/destiny_wheel/icon-skillwheel-vesselresonance-supreme',
    tone: '#7c3aed',
  },
  {
    id: 'task',
    label: 'Task Board',
    hint: 'Hunting tasks · gold & XP',
    icon: 'task_bounty/task_coin',
    tone: '#b45309',
  },
  {
    id: 'forge',
    label: 'Forja',
    hint: 'Exaltation · poeira · influência',
    icon: 'store/icon-currency-exaltedcore',
    tone: '#c2410c',
  },
];

export function progressaoIconClass(id: ProgressaoMenuId): string {
  return `prog-icon-${id}`;
}
