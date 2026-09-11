import { useEffect, useState } from 'react';
import { ApiError, api, storeToken } from '../api/client.js';
import { AuthLogo, AuthShell } from '../components/AuthShell.js';
import { useLocale } from '../i18n/Locale.js';

export function AuthScreen({ onReady, onHome }: { onReady: () => void; onHome: () => void }) {
  const { t } = useLocale();
  const [mode, setMode] = useState<'login' | 'register'>('register');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [invite, setInvite] = useState('');
  const [betaClosed, setBetaClosed] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api.health()
      .then((health) => setBetaClosed(health.beta === 'closed'))
      .catch(() => setError('Servidor da API offline. Rode pnpm dev na pasta do projeto.'));
  }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const result = mode === 'register'
        ? await api.register(username.trim(), password, invite.trim() || undefined)
        : await api.login(username.trim(), password);
      storeToken(result.token);
      onReady();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível conectar.');
    } finally {
      setBusy(false);
    }
  }

  async function playNow() {
    setBusy(true);
    setError('');
    try {
      const result = await api.guest();
      storeToken(result.token);
      onReady();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível conectar.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell footer={<span>Knock Idle BR · hunts oficiais · progressão idle</span>}>
      <button className="auth-back-home" type="button" onClick={onHome}>← VOLTAR AO INÍCIO</button>
      <div className="auth-card auth-card-enter">
        <AuthLogo subtitle={t('authLede')} />

        <button
          className="auth-play-now"
          type="button"
          disabled={busy}
          onClick={() => void playNow()}
        >
          <span className="auth-play-now-icon" aria-hidden>⚔</span>
          <span>
            <strong>{t('playNow')}</strong>
            <small>{t('playNowHint')}</small>
          </span>
        </button>

        <div className="auth-divider"><span>{t('authOr')}</span></div>

        <div className="auth-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'login'}
            className={mode === 'login' ? 'active' : ''}
            onClick={() => { setMode('login'); setError(''); }}
          >
            {t('signIn')}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'register'}
            className={mode === 'register' ? 'active' : ''}
            onClick={() => { setMode('register'); setError(''); }}
          >
            {t('createAccount')}
          </button>
        </div>

        <form className="auth-form" onSubmit={(event) => void submit(event)}>
          <div className="auth-field">
            <label htmlFor="auth-user">{t('account')}</label>
            <input
              id="auth-user"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="username"
              placeholder="seu_usuario"
            />
          </div>
          <div className="auth-field">
            <label htmlFor="auth-pass">{t('password')}</label>
            <input
              id="auth-pass"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
              placeholder="••••••••"
            />
          </div>
          {mode === 'register' && betaClosed && (
            <div className="auth-field">
              <label htmlFor="auth-invite">{t('invite')}</label>
              <input
                id="auth-invite"
                value={invite}
                onChange={(event) => setInvite(event.target.value)}
                autoComplete="off"
                placeholder="BETA-XXXX"
              />
            </div>
          )}
          {error ? <p className="auth-error">{error}</p> : null}
          <button className="auth-submit" disabled={busy} type="submit">
            {mode === 'register' ? t('createAccount') : t('signIn')}
          </button>
        </form>
      </div>
    </AuthShell>
  );
}
