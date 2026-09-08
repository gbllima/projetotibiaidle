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

export function AuthLogo({ subtitle }: { subtitle?: string }) {
  return (
    <header className="auth-logo">
      <h1>
        TIBIA <span>IDLE</span>
      </h1>
      {subtitle ? <p>{subtitle}</p> : null}
    </header>
  );
}
