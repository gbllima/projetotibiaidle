import type { ReactNode } from 'react';

const KNOCK_LOGO = '/home/Hunt.png';

const AUTH_THEME = `
.auth-page-bg {
  background:
    radial-gradient(circle at 78% 16%, rgba(36, 129, 70, 0.22), transparent 30%),
    radial-gradient(circle at 16% 78%, rgba(184, 126, 43, 0.14), transparent 30%),
    linear-gradient(180deg, #0b1110 0%, #080b0a 52%, #0e100d 100%) !important;
}
.auth-page-vignette {
  box-shadow: inset 0 0 140px rgba(0, 0, 0, 0.72) !important;
}
.auth-card,
.select-card {
  background: linear-gradient(180deg, rgba(24, 29, 24, 0.98) 0%, rgba(14, 18, 15, 0.99) 100%) !important;
  border: 1px solid #5b4828 !important;
  border-radius: 10px !important;
  box-shadow: 0 24px 55px rgba(0, 0, 0, 0.58), inset 0 1px 0 rgba(242, 207, 115, 0.06) !important;
}
.auth-logo h1 {
  font-family: 'Cinzel', serif !important;
  color: #f2cf73 !important;
  text-shadow: 2px 3px 0 #26180b, 0 0 24px rgba(215, 164, 63, 0.18) !important;
}
.auth-logo h1 span {
  color: #d8dcda !important;
}
.auth-logo p {
  color: #8f958b !important;
}
.auth-play-now {
  background: linear-gradient(100deg, rgba(29, 82, 48, 0.46), rgba(23, 32, 25, 0.96)) !important;
  border: 1px solid #66502a !important;
  border-left: 3px solid #49ad68 !important;
  color: #f2cf73 !important;
}
.auth-play-now:hover:not(:disabled) {
  border-color: #d7a43f !important;
  box-shadow: 0 8px 24px rgba(215, 164, 63, 0.15) !important;
}
.auth-play-now small {
  color: #9ab29e !important;
}
.auth-tabs {
  background: #0c100d !important;
  border-color: #403722 !important;
}
.auth-tabs button.active {
  background: linear-gradient(180deg, #2c281c, #171813) !important;
  color: #f2cf73 !important;
  box-shadow: inset 0 0 0 1px rgba(242, 207, 115, 0.12) !important;
}
.auth-field label {
  color: #8d866d !important;
}
.auth-field input {
  background: #0b0f0d !important;
  border: 1px solid #403722 !important;
  color: #ece9df !important;
}
.auth-field input:focus {
  border-color: #8e6b2d !important;
  box-shadow: 0 0 0 3px rgba(215, 164, 63, 0.08) !important;
}
.auth-password-wrap {
  position: relative;
}
.auth-password-wrap input {
  padding-right: 44px !important;
}
.auth-password-toggle {
  position: absolute;
  top: 50%;
  right: 6px;
  width: 34px;
  height: 30px;
  transform: translateY(-50%);
  display: grid;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: #c9b066;
  font-size: 15px;
  cursor: pointer;
}
.auth-password-toggle:hover {
  background: rgba(242, 207, 115, .08);
  color: #f2cf73;
}
.auth-social-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin-top: 10px;
}
.auth-social {
  min-height: 42px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border: 1px solid #4b412d;
  border-radius: 7px;
  background: #121612;
  color: #e6e2d6;
  font-size: 12px;
  font-weight: 800;
  cursor: pointer;
}
.auth-social span {
  width: 20px;
  height: 20px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: #ecebe6;
  color: #171913;
  font-size: 11px;
  font-weight: 900;
}
.auth-social:hover:not(:disabled) {
  border-color: #8e6b2d;
  background: #191d17;
}
.auth-social:disabled {
  opacity: .42;
  cursor: not-allowed;
}
.auth-social-discord span {
  border-radius: 6px;
  background: #5865f2;
  color: white;
}
.auth-mode-heading {
  margin: 0 0 14px;
  padding: 10px 12px;
  border: 1px solid #403722;
  border-radius: 7px;
  background: #0c100d;
}
.auth-mode-heading strong {
  color: #f2cf73;
  font-size: 14px;
}
.auth-mode-heading p {
  margin: 4px 0 0;
  color: #8f958b;
  font-size: 11px;
  line-height: 1.4;
}
.auth-text-action {
  margin: 8px auto 0;
  border: 0;
  background: transparent;
  color: #c5ae69;
  font-size: 11px;
  text-decoration: underline;
  cursor: pointer;
}
.auth-info {
  margin: 8px 0 4px;
  padding: 9px 11px;
  border: 1px solid rgba(82, 148, 93, .35);
  border-radius: 7px;
  background: rgba(46, 93, 54, .12);
  color: #bcd3bb;
  font-size: 11px;
  line-height: 1.4;
}
@media (max-width: 430px) {
  .auth-social-grid {
    grid-template-columns: 1fr;
  }
}
.auth-submit {
  background: linear-gradient(180deg, #efc55f 0%, #c88b2c 55%, #a56b20 100%) !important;
  border: 1px solid #9a6e25 !important;
  color: #15100a !important;
  box-shadow: inset 0 1px 0 #ffe5a0, inset 0 -2px 0 #684015, 0 8px 24px rgba(0, 0, 0, 0.35) !important;
}
.auth-submit:hover:not(:disabled) {
  background: linear-gradient(180deg, #f6d276 0%, #d69a36 55%, #b67825 100%) !important;
  border-color: #d7a43f !important;
}
.auth-divider {
  color: #73776e !important;
}
.auth-footer {
  color: #777f76 !important;
}
`;

export function AuthShell({
  children,
  wide = false,
  footer,
}: {
  children: ReactNode;
  wide?: boolean;
  footer?: ReactNode;
}) {
  return (
    <div className="auth-page">
      <style>{AUTH_THEME}</style>
      <div className="auth-page-bg" aria-hidden />
      <div className="auth-page-vignette" aria-hidden />
      <main className={`auth-shell ${wide ? 'auth-shell-wide' : ''}`}>
        {children}
      </main>
      {footer ? <footer className="auth-footer">{footer}</footer> : null}
    </div>
  );
}

export function AuthLogo({ subtitle }: { subtitle?: string }) {
  return (
    <header className="auth-logo">
      <img
        src={KNOCK_LOGO}
        alt="Knock Hunt BR"
        style={{ width: 132, maxWidth: '52%', height: 'auto', marginBottom: 12 }}
      />
      <h1>
        KNOCK <span>HUNT BR</span>
      </h1>
      <p style={{ marginTop: 6, color: '#d0ae4f', fontSize: 11, letterSpacing: '0.14em', fontWeight: 700 }}>
        O RPG IDLE BRASILEIRO
      </p>
      {subtitle ? <p>{subtitle}</p> : null}
    </header>
  );
}
