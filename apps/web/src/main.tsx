import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { LocaleProvider } from './i18n/Locale.js';
import './styles.css';
import './landing.css';
import './party.css';
import './party-items.css';
import './mobile.css';
import './mobile-hunt.css';
import './mobile-topmenus.css';

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

const chatObserver = new MutationObserver(enhanceChatConsole);
chatObserver.observe(root, { childList: true, subtree: true });
enhanceChatConsole();
