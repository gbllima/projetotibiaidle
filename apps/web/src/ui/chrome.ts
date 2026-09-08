/** Official client UI copied to /assets/ui by tools/extractor/copy_ui.py. */
export function uiUrl(rel: string): string {
  const clean = rel.replace(/^\//, '').replace(/\.(png|webp)$/i, '');
  return `/assets/ui/${clean}.webp`;
}

/** Item / misc sprites under /assets (not the ui/ subtree). */
export function assetUrl(rel: string): string {
  const clean = rel.replace(/^\//, '').replace(/\.(png|webp)$/i, '');
  return `/assets/${clean}.webp`;
}

export const NAV_ICON: Record<string, string> = {
  /** Build — combat controls */
  build: 'topbuttons/combatcontrols',
};

/** Colorful in-game UI sprites (under /assets/ui/) that beat flat topbuttons. */
export const NAV_UI_ICON: Record<string, string> = {
  /** Progressão — hub de sistemas (imbuements, prey, wheel, tasks, forja) */
  progressao: 'icons/icon-progressanalyser-widget',
  /** Helper — cura, poções e magias automáticas */
  helper: 'icons/icon-healing',
  /** Cyclopedia — bestiário, itens e personagem */
  cyclopedia: 'game/cyclopedia/icons/icon-cyclopedia-monsterinfo',
  /** Mercado — compras com gold (NPC) */
  market: 'game/cyclopedia/icons/icon-goldcoin',
  /** Loja — Store com Tibia Coins */
  loja: 'store/button-storeicon',
  /** VIP — Premium Account */
  vip: 'icons/icon-crownsetoutfit',
  /** Roleta — TC item roulette */
  roleta: 'game/prey/icon-prey-widget',
};

/** Colorful item sprites that read better at nav size than flat topbuttons. */
export const NAV_ASSET_ICON: Record<string, string> = {
  /** Depot — armazém */
  depot: 'item-icons/3502',
  /** Rank — highscores */
  rank: 'item-icons/6434',
};
