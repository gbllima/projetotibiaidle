import { formatStamina } from '../format.js';
import { useLocale } from '../i18n/Locale.js';
import { NAV_ASSET_ICON, NAV_ICON, NAV_UI_ICON, assetUrl, uiUrl } from '../ui/chrome.js';

export type OverlayId =
  | 'none'
  | 'helper'
  | 'cyclopedia'
  | 'market'
  | 'loja'
  | 'vip'
  | 'rank'
  | 'build'
  | 'progressao'
  | 'roleta'
  | 'depot'
  | 'guild';

export const NAV: Array<{ id: OverlayId; label: string; tone: string }> = [
  { id: 'guild', label: 'Guild', tone: '#466a47' },
  { id: 'helper', label: 'Helper', tone: '#1e40af' },
  { id: 'cyclopedia', label: 'Cyclopedia', tone: '#1d4ed8' },
  { id: 'market', label: 'Mercado', tone: '#a16207' },
  { id: 'loja', label: 'Loja', tone: '#c2410c' },
  { id: 'vip', label: 'VIP', tone: '#b45309' },
  { id: 'rank', label: 'Rank', tone: '#7c2d12' },
  { id: 'build', label: 'Build', tone: '#3b82f6' },
  { id: 'progressao', label: 'Progressão', tone: '#6366f1' },
  { id: 'roleta', label: 'Roleta', tone: '#6d28d9' },
  { id: 'depot', label: 'Depot', tone: '#92400e' },
];

function Glyph({ id }: { id: OverlayId }) {
  switch (id) {
    case 'helper':
      return <path d="M10 3c-2 0-3 1.6-3 3.4 0 2.6 3 6.6 5 8.6 2-2 5-6 5-8.6C17 4.6 16 3 14 3c-1.2 0-2 .7-2 1.6C12 3.7 11.2 3 10 3z" />;
    case 'cyclopedia':
      return <path d="M5 4h6a3 3 0 0 1 3 3v11H8a3 3 0 0 0-3 3V4zm8 0h2a3 3 0 0 1 3 3v11h-5V7a3 3 0 0 0-3-3z" />;
    case 'market':
      return <path d="M6 4h8l4 4v12H6V4zm8 0v4h4" />;
    case 'loja':
      return <path d="M4 8h16l-1 12H5L4 8zm3-3h10l1 3H6l1-3z" />;
    case 'vip':
      return <path d="M4 8l3 2 5-6 5 6 3-2-2 12H6L4 8z" />;
    case 'rank':
      return <path d="M6 16h3V8H6v8zm5 4h3V4h-3v16zm5-7h3V9h-3v4z" />;
    case 'build':
      return <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z" />;
    case 'progressao':
      return (
        <>
          <path d="M4 18V6l8-3 8 3v12l-8 3-8-3z" opacity="0.35" />
          <path d="M12 8v8M8 10l4-2 4 2" />
        </>
      );
    case 'roleta':
      return (
        <>
          <path d="M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0-18zm0 2a7 7 0 1 1 0 14a7 7 0 0 1 0-14z" opacity="0.35" />
          <path d="M12 5v7l5.2 3" />
          <circle cx="12" cy="12" r="1.8" />
        </>
      );
    case 'depot':
      return <path d="M5 8h14v10a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V8zm2-3h10l1 3H6l1-3z" />;
    default:
      return <circle cx="12" cy="12" r="6" />;
  }
}

export function TopNav({
  name,
  gold,
  coins,
  health,
  maxHealth,
  mana,
  maxMana,
  level,
  xpPercent,
  stamina,
  overlay,
  onOverlay,
  onBack,
  onSettings,
  onCity,
  onTraining,
  badges,
}: {
  name: string;
  gold: number;
  coins: number;
  health: number;
  maxHealth: number;
  mana: number;
  maxMana: number;
  level: number;
  xpPercent: number;
  stamina: number;
  overlay: OverlayId;
  onOverlay: (id: OverlayId) => void;
  onBack: () => void;
  onSettings?: () => void;
  onCity: () => void;
  onTraining: () => void;
  badges?: Partial<Record<OverlayId, string>>;
}) {
  const { locale, setLocale, t } = useLocale();
  const hp = Math.max(0, Math.min(100, (health / Math.max(1, maxHealth)) * 100));
  const mp = Math.max(0, Math.min(100, (mana / Math.max(1, maxMana)) * 100));
  const sta = Math.max(0, Math.min(100, (stamina / 2520) * 100));
  return (
    <header className="topnav">
      <div className="logo">TIBIA <span>IDLE</span></div>
      <div className="who">
        <strong>{name}</strong>
        <small>lvl {level}</small>
      </div>
      <div className="top-vitals">
        <div className="top-bar" title={`HP ${health}/${maxHealth}`}>
          <span>HP</span>
          <div className="meter hp"><i style={{ width: `${hp}%` }} /></div>
        </div>
        <div className="top-bar" title={`MP ${mana}/${maxMana}`}>
          <span>MP</span>
          <div className="meter mana"><i style={{ width: `${mp}%` }} /></div>
        </div>
        <div className="top-bar" title={`XP ${Math.round(xpPercent)}%`}>
          <span>XP</span>
          <div className="meter xp"><i style={{ width: `${xpPercent}%` }} /></div>
        </div>
        <div className="top-bar" title={`Stamina ${formatStamina(stamina)}`}>
          <span>ST</span>
          <div className="meter stamina"><i style={{ width: `${sta}%` }} /></div>
        </div>
      </div>
      <div className="pill gold">
        <i className="coin-dot" />
        {gold.toLocaleString('pt-BR')}
      </div>
      <div className="pill coin">
        <i className="crystal-dot" />
        {coins}
      </div>
      <nav className="nav-icons">
        {NAV.map((item) => (
          <button
            key={item.id}
            className={`iconbtn nav-${item.id} ${overlay === item.id ? 'on' : ''}`}
            title={item.label}
            onClick={() => onOverlay(item.id)}
          >
            <span className="ico" style={{ background: item.tone }}>
              {NAV_ASSET_ICON[item.id] ? (
                <img className="nav-item-icon" src={assetUrl(NAV_ASSET_ICON[item.id]!)} alt="" />
              ) : NAV_UI_ICON[item.id] ? (
                <img className="nav-ui-icon" src={uiUrl(NAV_UI_ICON[item.id]!)} alt="" />
              ) : NAV_ICON[item.id] ? (
                <img className="nav-ui-icon" src={uiUrl(NAV_ICON[item.id]!)} alt="" />
              ) : (
                <svg viewBox="0 0 24 24" aria-hidden="true"><Glyph id={item.id} /></svg>
              )}
              {badges?.[item.id] !== undefined && <em>{badges[item.id]}</em>}
            </span>
            <small>{item.label}</small>
          </button>
        ))}
      </nav>
      <div className="top-right">
        <button className="btn" onClick={onTraining}>Treino online</button>
        <button className="btn" onClick={onCity}>Cidade</button>
        <button className={`flag ${locale === 'pt' ? 'on' : ''}`} title="PT" onClick={() => setLocale('pt')}>
          <img src={uiUrl('flags/bra')} alt="BR" />
        </button>
        <button className={`flag ${locale === 'en' ? 'on' : ''}`} title="EN" onClick={() => setLocale('en')}>
          <img src={uiUrl('flags/en')} alt="US" />
        </button>
        <button className="iconbtn mini" title="Discord" onClick={onSettings}>Ds</button>
        <button className="iconbtn mini" title={t('settings')} onClick={onSettings}>⚙</button>
        <button className="iconbtn mini" title={t('logout')} onClick={onBack}>{t('logout')}</button>
      </div>
    </header>
  );
}
