import type { ReactNode } from 'react';

const KNOCK_LOGO = '/home/knock-idle-br-logo.png';

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
        alt="Knock Idle BR"
        style={{ width: 132, maxWidth: '52%', height: 'auto', marginBottom: 12 }}
      />
      <h1>
        KNOCK <span>IDLE BR</span>
      </h1>
      <p style={{ marginTop: 6, color: '#d0ae4f', fontSize: 11, letterSpacing: '0.14em', fontWeight: 700 }}>
        O RPG IDLE BRASILEIRO
      </p>
      {subtitle ? <p>{subtitle}</p> : null}
    </header>
  );
}
