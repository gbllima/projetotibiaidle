import { useEffect, useMemo, useState } from 'react';
import { ApiError, api, storeToken } from '../api/client.js';
import { AuthLogo, AuthShell } from '../components/AuthShell.js';
import { useLocale } from '../i18n/Locale.js';

type AuthMode = 'login' | 'register' | 'forgot' | 'reset';

export function AuthScreen({ onReady }: { onReady: () => void }) {
  const { t } = useLocale();
  const resetToken = useMemo(() => {
    if (typeof window === 'undefined') return '';
    return new URLSearchParams(window.location.search).get('reset') ?? '';
  }, []);
  const [mode, setMode] = useState<AuthMode>(resetToken ? 'reset' : 'register');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [invite, setInvite] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [betaClosed, setBetaClosed] = useState(false);
  const [oauth, setOauth] = useState({ google: false, discord: false });
  const [passwordRecovery, setPasswordRecovery] = useState(true);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const oauthCode = params.get('oauth_code');
    const oauthError = params.get('oauth_error');
    if (oauthError) {
      setError(oauthError);
      params.delete('oauth_error');
      const query = params.toString();
      window.history.replaceState({}, '', window.location.pathname + (query ? `?${query}` : '') + window.location.hash);
      return;
    }
    if (!oauthCode) return;
    setBusy(true);
    void api.oauthExchange(oauthCode)
      .then((result) => {
        storeToken(result.token);
        params.delete('oauth_code');
        const query = params.toString();
        window.history.replaceState({}, '', window.location.pathname + (query ? `?${query}` : '') + window.location.hash);
        onReady();
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Falha no login social.'))
      .finally(() => setBusy(false));
  }, [onReady]);

  useEffect(() => {
    void api.health()
      .then((health) => {
        setBetaClosed(health.beta === 'closed');
        setOauth(health.oauth ?? { google: false, discord: false });
        setPasswordRecovery(health.passwordRecovery !== false);
      })
      .catch(() => setError('Servidor da API offline. Rode pnpm dev na pasta do projeto.'));
  }, []);

  function changeMode(next: AuthMode) {
    setMode(next);
    setError('');
    setInfo('');
    setPassword('');
    setPasswordVisible(false);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setInfo('');
    try {
      if (mode === 'forgot') {
        const result = await api.forgotPassword(email.trim());
        setInfo(result.message);
        if (result.devResetUrl) setInfo(`${result.message} Ambiente local: ${result.devResetUrl}`);
        return;
      }
      if (mode === 'reset') {
        const result = await api.resetPassword(resetToken, password);
        storeToken(result.token);
        const clean = new URL(window.location.href);
        clean.searchParams.delete('reset');
        window.history.replaceState({}, '', clean.pathname + clean.search + clean.hash);
        onReady();
        return;
      }
      const result = mode === 'register'
        ? await api.register(username.trim(), password, email.trim(), invite.trim() || undefined)
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

  function social(provider: 'google' | 'discord') {
    window.location.assign(`/api/oauth/${provider}/start`);
  }

  const credentialMode = mode === 'login' || mode === 'register';

  return (
    <AuthShell footer={<span>KNOCK HUNT BR · O RPG IDLE BRASILEIRO</span>}>
      <div className="auth-card auth-card-enter">
        <AuthLogo subtitle="Entre no mundo do Knock Hunt BR e continue sua aventura." />

        {credentialMode && (
          <>
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

            <div className="auth-social-grid">
              <button
                className="auth-social auth-social-google"
                type="button"
                disabled={busy || !oauth.google}
                title={oauth.google ? 'Entrar com Google' : 'Google OAuth ainda não configurado no servidor'}
                onClick={() => social('google')}
              >
                <span aria-hidden>G</span> Google
              </button>
              <button
                className="auth-social auth-social-discord"
                type="button"
                disabled={busy || !oauth.discord}
                title={oauth.discord ? 'Entrar com Discord' : 'Discord OAuth ainda não configurado no servidor'}
                onClick={() => social('discord')}
              >
                <span aria-hidden>◈</span> Discord
              </button>
            </div>

            <div className="auth-divider"><span>{t('authOr')}</span></div>

            <div className="auth-tabs" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'login'}
                className={mode === 'login' ? 'active' : ''}
                onClick={() => changeMode('login')}
              >
                {t('signIn')}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'register'}
                className={mode === 'register' ? 'active' : ''}
                onClick={() => changeMode('register')}
              >
                {t('createAccount')}
              </button>
            </div>
          </>
        )}

        {mode === 'forgot' && (
          <div className="auth-mode-heading">
            <strong>Recuperar senha</strong>
            <p>Informe o email cadastrado. Você receberá um link válido por 30 minutos.</p>
          </div>
        )}
        {mode === 'reset' && (
          <div className="auth-mode-heading">
            <strong>Criar nova senha</strong>
            <p>Digite a nova senha da sua conta.</p>
          </div>
        )}

        <form className="auth-form" onSubmit={(event) => void submit(event)}>
          {credentialMode && (
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
          )}

          {(mode === 'register' || mode === 'forgot') && (
            <div className="auth-field">
              <label htmlFor="auth-email">Email</label>
              <input
                id="auth-email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="email"
                placeholder="voce@email.com"
              />
            </div>
          )}

          {(mode === 'login' || mode === 'register' || mode === 'reset') && (
            <div className="auth-field">
              <label htmlFor="auth-pass">{mode === 'reset' ? 'Nova senha' : t('password')}</label>
              <div className="auth-password-wrap">
                <input
                  id="auth-pass"
                  type={passwordVisible ? 'text' : 'password'}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  className="auth-password-toggle"
                  aria-label={passwordVisible ? 'Ocultar senha' : 'Mostrar senha'}
                  title={passwordVisible ? 'Ocultar senha' : 'Mostrar senha'}
                  onClick={() => setPasswordVisible((current) => !current)}
                >
                  {passwordVisible ? '👁' : '👁'}
                </button>
              </div>
            </div>
          )}

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
          {info ? <p className="auth-info">{info}</p> : null}

          <button className="auth-submit" disabled={busy} type="submit">
            {mode === 'register'
              ? t('createAccount')
              : mode === 'login'
                ? t('signIn')
                : mode === 'forgot'
                  ? 'Enviar link de recuperação'
                  : 'Salvar nova senha'}
          </button>

          {mode === 'login' && passwordRecovery && (
            <button type="button" className="auth-text-action" onClick={() => changeMode('forgot')}>
              Esqueci minha senha
            </button>
          )}
          {(mode === 'forgot' || mode === 'reset') && (
            <button type="button" className="auth-text-action" onClick={() => changeMode('login')}>
              Voltar para o login
            </button>
          )}
        </form>
      </div>
    </AuthShell>
  );
}
