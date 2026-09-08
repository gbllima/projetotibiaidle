import type { CharacterView } from '../api/types.js';
import { useLocale } from '../i18n/Locale.js';
import type { MessageKey } from '../i18n/strings.js';

const TIPS: Array<{ step: number; key: MessageKey }> = [
  { step: 1, key: 'tip1' },
  { step: 2, key: 'tip2' },
  { step: 3, key: 'tip3' },
  { step: 4, key: 'tip4' },
  { step: 5, key: 'tip5' },
];

export function Onboarding({
  character,
  onAdvance,
  onSkip,
}: {
  character: CharacterView;
  onAdvance: (step: number) => void;
  onSkip: () => void;
}) {
  const { t } = useLocale();
  const step = character.onboardingStep ?? 0;
  if (step <= 0 || step >= 99) return null;

  let tip = TIPS.find((entry) => entry.step === step) ?? null;
  if (step === 1 && (character.session?.totals.kills ?? 0) >= 3) tip = TIPS[1] ?? tip;
  if (character.level > 8 && step < 3) tip = TIPS[2] ?? tip;
  if (!tip) return null;

  const next = step >= 5 ? 99 : step + 1;

  return (
    <div className="onboard">
      <p>{t(tip.key)}</p>
      <div className="row">
        <button className="btn gold" onClick={() => onAdvance(next)}>{next === 99 ? t('gotIt') : t('next')}</button>
        <button className="btn ghost" onClick={onSkip}>{t('skip')}</button>
      </div>
    </div>
  );
}
