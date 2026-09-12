import { useState, type CSSProperties } from 'react';
import { PLAYABLE_VOCATION_IDS, vocationsById } from '@tibia-idle/data';
import { ApiError, api, storeToken } from '../api/client.js';
import { AuthLogo, AuthShell } from '../components/AuthShell.js';
import { useLocale } from '../i18n/Locale.js';
import type { AccountView, CharacterView } from '../api/types.js';

const BLURBS: Record<number, string> = {
  4: 'Tank · corpo a corpo',
  9: 'Tank · punhos',
  3: 'Atirador · distância',
  1: 'Atirador · magia',
  2: 'Atirador · magia + cura',
};

const VOC_ACCENT: Record<number, string> = {
  4: '#c45c3e',
  9: '#d4a843',
  3: '#6aab6a',
  1: '#7b6cf0',
  2: '#3dba9a',
};

const WEAPONS = ['Machado', 'Espada', 'Clava'] as const;

export function SelectScreen({
  characters,
  account,
  onEnter,
  onRefresh,
  onLogout,
}: {
  characters: CharacterView[];
  account: AccountView | null;
  onEnter: (id: number) => void;
  onRefresh: () => Promise<void>;
  onLogout: () => void;
}) {
  const { t } = useLocale();
  const [name, setName] = useState('');
  const [vocationId, setVocationId] = useState(4);
  const [gender, setGender] = useState<'m' | 'f'>('m');
  const [weapon, setWeapon] = useState<(typeof WEAPONS)[number]>('Espada');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [claimUser, setClaimUser] = useState('');
  const [claimPass, setClaimPass] = useState('');
  const slots = account?.slots ?? 5;
  const used = account?.used ?? characters.length;
  const full = used >= slots;

  async function create(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const created = await api.createCharacter(name.trim(), vocationId, {
        gender,
        weapon: weapon === 'Machado' ? 'axe' : weapon === 'Clava' ? 'club' : 'sword',
      });
      await onRefresh();
      onEnter(created.character.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Falha ao criar personagem.');
    } finally {
      setBusy(false);
    }
  }

  async function claim(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const result = await api.claim(claimUser.trim(), claimPass);
      storeToken(result.token);
      await onRefresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Falha ao reivindicar a conta.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell wide>
      <div className="select-card auth-card-enter">
        <div className="select-topbar">
          <AuthLogo subtitle={t('createCharLede')} />
          <div className="select-topbar-actions">
            <span className="select-slots-pill">
              {t('charSlots')} <strong>{used}/{slots}</strong>
            </span>
            <button className="auth-link-btn" type="button" onClick={onLogout}>
              {t('selectLogout')}
            </button>
          </div>
        </div>

        {account?.guest && (
          <form className="select-claim" onSubmit={(event) => void claim(event)}>
            <div className="select-claim-copy">
              <strong>{t('claimTitle')}</strong>
              <p>{t('claimLede')}</p>
            </div>
            <div className="select-claim-fields">
              <input
                value={claimUser}
                onChange={(event) => setClaimUser(event.target.value)}
                autoComplete="username"
                placeholder={t('account')}
              />
              <input
                type="password"
                value={claimPass}
                onChange={(event) => setClaimPass(event.target.value)}
                autoComplete="new-password"
                placeholder={t('password')}
              />
              <button className="btn gold" disabled={busy} type="submit">{t('claim')}</button>
            </div>
          </form>
        )}

        <div className="select-grid">
          <section className="select-roster">
            <h2>{t('selectYourChar')}</h2>
            {characters.length === 0 ? (
              <p className="select-empty">{t('selectEmpty')}</p>
            ) : (
              <ul className="select-char-list">
                {characters.map((character) => {
                  const principalId = character.partyMemberIds?.[0] ?? character.id;
                  const isPrincipal = principalId === character.id;
                  const principal = characters.find((entry) => entry.id === principalId);
                  return (
                  <li key={character.id}>
                    <button
                      type="button"
                      className="select-char-card"
                      disabled={!isPrincipal}
                      title={!isPrincipal ? `Entre pelo personagem principal${principal ? `: ${principal.name}` : ''}.` : undefined}
                      style={{ '--voc-accent': VOC_ACCENT[character.vocation.id] ?? '#e8c547' } as CSSProperties}
                      onClick={() => { if (isPrincipal) onEnter(character.id); }}
                    >
                      <div className="select-char-main">
                        <strong>{character.name}</strong>
                        <span>{character.vocation.name}</span>
                      </div>
                      <div className="select-char-meta">
                        <span className="select-char-level">Lv {character.level}</span>
                        <span className="select-char-gold">{character.gold.toLocaleString('pt-BR')} gp</span>
                      </div>
                      <span className="select-char-enter">
                        {isPrincipal ? `${t('selectEnter')} →` : 'Membro da party'}
                      </span>
                    </button>
                  </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="select-create">
            <h2>{t('selectCreateSection')}</h2>
            <form onSubmit={(event) => void create(event)}>
              <div className="auth-field">
                <label htmlFor="char-name">{t('name')}</label>
                <input
                  id="char-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  maxLength={20}
                  placeholder="Sir Bowen"
                />
              </div>

              <label>{t('sex')}</label>
              <div className="auth-chip-row">
                <button type="button" className={`auth-chip ${gender === 'm' ? 'active' : ''}`} onClick={() => setGender('m')}>
                  {t('male')}
                </button>
                <button type="button" className={`auth-chip ${gender === 'f' ? 'active' : ''}`} onClick={() => setGender('f')}>
                  {t('female')}
                </button>
              </div>

              <span id="char-vocation-label">{t('vocation')}</span>
              <div className="select-voc-grid" role="group" aria-labelledby="char-vocation-label">
                {PLAYABLE_VOCATION_IDS.map((id) => {
                  const vocation = vocationsById.get(id);
                  if (!vocation) return null;
                  return (
                    <button
                      type="button"
                      key={id}
                      className={`select-voc ${vocationId === id ? 'active' : ''}`}
                      aria-pressed={vocationId === id}
                      style={{ '--voc-accent': VOC_ACCENT[id] ?? '#e8c547' } as CSSProperties}
                      onClick={() => setVocationId(id)}
                    >
                      <strong>{vocation.name}</strong>
                      <small>{BLURBS[id]}</small>
                    </button>
                  );
                })}
              </div>

              {vocationId === 4 && (
                <>
                  <label>{t('knightWeapon')}</label>
                  <div className="auth-chip-row">
                    {WEAPONS.map((item) => (
                      <button
                        type="button"
                        key={item}
                        className={`auth-chip ${weapon === item ? 'active' : ''}`}
                        onClick={() => setWeapon(item)}
                      >
                        {item}
                      </button>
                    ))}
                  </div>
                </>
              )}

              {full && <p className="select-full">{t('selectSlotsFull')}</p>}
              {error ? <p className="auth-error">{error}</p> : null}

              <button className="auth-submit" disabled={busy || full} type="submit">
                {t('create')}
              </button>
            </form>
          </section>
        </div>
      </div>
    </AuthShell>
  );
}
