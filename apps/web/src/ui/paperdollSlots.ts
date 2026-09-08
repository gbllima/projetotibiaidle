import type { MessageKey } from '../i18n/strings.js';

export const PAPERDOLL_SLOTS: Array<{ id: string; area: string; empty?: MessageKey }> = [
  { id: 'necklace', area: 'necklace', empty: 'slotAmulet' },
  { id: 'head', area: 'head' },
  { id: 'backpack', area: 'backpack' },
  { id: 'left', area: 'left' },
  { id: 'armor', area: 'armor' },
  { id: 'right', area: 'right' },
  { id: 'ring', area: 'ring', empty: 'slotRing' },
  { id: 'legs', area: 'legs' },
  { id: 'ammo', area: 'ammo', empty: 'slotTrinket' },
  { id: 'feet', area: 'feet' },
];
