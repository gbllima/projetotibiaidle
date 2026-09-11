import type { ReactNode } from 'react';

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

export function AuthLogo({ subtitle, compact = false }: { subtitle?: string; compact?: boolean }) {
  return (
    <header className={`auth-logo${compact ? ' auth-logo-compact' : ''}`}>
      <img src="/home/knock-idle-br-logo.png" alt="Knock Idle BR" />
      <div className="auth-logo-title">KNOCK IDLE BR</div>
      <div className="auth-logo-kicker">O RPG IDLE BRASILEIRO</div>
      {subtitle ? <p>{subtitle}</p> : null}
    </header>
  );
}
