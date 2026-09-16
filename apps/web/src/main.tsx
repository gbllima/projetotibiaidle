import 'pixi.js/unsafe-eval';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { LocaleProvider } from './i18n/Locale.js';
import './render/vocationLookPatch.js';
import './render/combatTextSizePatch.js';
import './multiplayer-party-leader-control.js';
import './vip-name-visuals.js';
import './market-v2-ui.js';
import './market-price-protection.js';
import './market-v2-layout-fix.css';
import './styles.css';
import './landing.css';
import './party.css';
import './party-items.css';
import './mobile.css';
import './mobile-hunt.css';
import './mobile-topmenus.css';
import './mobile-chat.css';
import './mobile-nav-icons.css';
import './mobile-menu-responsive.css';
import './mobile-bottom-theme.css';
import './mobile-training.css';
import './mobile-top-tutorial.css';
import './game-site-theme.css';
import './game-modal-theme.css';
import './compact-action-helper.css';
import './helper-ally-heal.css';
import './warm-project-theme.css';
import './party-mobile-close.css';
import './mobile-hide-arena-city.css';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root');

createRoot(root).render(
  <StrictMode>
    <LocaleProvider>
      <App />
    </LocaleProvider>
  </StrictMode>,
);

function enhanceChatConsole() {
  const chats = document.querySelectorAll<HTMLElement>('.chat-console');
  chats.forEach((chat) => {
    const head = chat.querySelector<HTMLElement>('.chat-console__head');
    if (!head || head.querySelector('.chat-console__minimize')) return;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'chat-console__minimize';
    button.setAttribute('aria-label', 'Minimizar chat');
    button.title = 'Minimizar chat';
    button.textContent = '−';
    button.addEventListener('click', () => {
      const minimized = chat.classList.toggle('is-minimized');
      button.textContent = minimized ? '+' : '−';
      button.title = minimized ? 'Expandir chat' : 'Minimizar chat';
      button.setAttribute('aria-label', minimized ? 'Expandir chat' : 'Minimizar chat');
    });
    head.appendChild(button);
  });
}

function enhanceMobileTutorial() {
  const topnavs = document.querySelectorAll<HTMLElement>('.topnav');
  topnavs.forEach((topnav) => {
    if (topnav.querySelector('.mobile-wiki-link')) return;
    const who = topnav.querySelector<HTMLElement>('.who');
    if (!who) return;

    const link = document.createElement('a');
    link.className = 'mobile-wiki-link';
    link.href = '#wiki';
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = 'Tutorial';
    link.setAttribute('aria-label', 'Abrir Tutorial em nova aba');
    who.insertAdjacentElement('afterend', link);
  });
}

function enhanceUi() {
  enhanceChatConsole();
  enhanceMobileTutorial();
}

const chatObserver = new MutationObserver(enhanceUi);
chatObserver.observe(root, { childList: true, subtree: true });
enhanceUi();
