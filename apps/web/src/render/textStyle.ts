/** Compact Tibia-style labels. Scenes render at 2x, giving 12px text and a 1px outline. */
export const NAME_STYLE = {
  fill: 0x00ff00,
  fontFamily: 'Tahoma, Verdana, sans-serif',
  fontSize: 6,
  fontWeight: 'bold' as const,
  stroke: { color: 0x000000, width: 0.5, join: 'round' as const },
  align: 'center' as const,
  letterSpacing: 0,
  padding: 2,
};
