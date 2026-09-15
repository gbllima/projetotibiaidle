import { useEffect, useState } from 'react';
import { ApiError, api, LiveSocket, storeToken, storedToken } from './api/client.js';
import type { AccountView, CharacterView, Settlement } from './api/types.js';
import { useLocale } from './i18n/Locale.js';
import { AuthScreen } from './screens/AuthScreen.js';
import { GameScreen } from './screens/GameScreen.js';
import { CreateCharacterScreen } from './screens/CreateCharacterScreen.js';
import { HomeScreen } from './screens/HomeScreen.js';
import { PortalScreen } from './screens/PortalScreen.js';
import { WikiScreen } from './screens/WikiScreen.js';
import { AccountScreen } from './screens/AccountScreen.js';
import { KnockRadio } from './components/KnockRadio.js';

type Screen = 'portal' | 'wiki' | 'account' | 'home' | 'boot' | 'auth' | 'create' | 'game';

export function App() {
  const { t } = useLocale();
  const [screen, setScreen] = useState<Screen>(() => typeof window !== 'undefined' && window.location.hash === '#wiki' ? 'wiki' : 'portal');
  const [afterAuth, setAfterAuth] = useState<'account' | 'game'>('game');
  const [entryError, setEntryError] = useState('');
  const [account, setAccount] = useState<AccountView | null>(null);
  const [character, setCharacter] = useState<CharacterView | null>(null);
  const [settlement, setSettlement] = useState<Settlement | null>(null);
  const [socketStatus, setSocketStatus] = useState<'connecting' | 'open' | 'closed'>('closed');
  const [hadSocket, setHadSocket] = useState(false);

  async function loadRoster() {
    const payload = await api.characters();
    setAccount(payload.account ?? null);
    return payload.characters;
  }

  async function enterCharacter(id: number) {
    const payload = await api.character(id);
    setCharacter(payload.character);
    setSettlement(payload.settlement);
    setScreen('game');
  }

  async function enterGame() {
    setEntryError('');
    if (!storedToken()) { setAfterAuth('game'); setScreen('auth'); return; }
    setScreen('boot');
    try {
      const roster = await loadRoster();
      const first = roster.reduce<CharacterView | null>((oldest, next) => !oldest || next.id < oldest.id ? next : oldest, null);
      if (!first) { setScreen('create'); return; }
      const principalId = first.partyMemberIds?.[0] ?? first.id;
      await enterCharacter(roster.some(entry => entry.id === principalId) ? principalId : first.id);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        storeToken(null); setAfterAuth('game'); setScreen('auth'); return;
      }
      setEntryError(error instanceof Error ? error.message : 'Falha ao entrar no jogo.');
    }
  }

  function logout() {
    void api.logout(); storeToken(null); setCharacter(null); setAccount(null); setSettlement(null); setScreen('home');
  }

  useEffect(() => {
    if (screen !== 'game' || !character) return;
    const socket = new LiveSocket(character.id, (next, nextSettlement) => {
      setCharacter(next); setSettlement(nextSettlement);
    }, status => {
      setSocketStatus(status);
      if (status === 'open') setHadSocket(true);
    });
    return () => { socket.close(); setSocketStatus('closed'); setHadSocket(false); };
  }, [screen, character?.id]);

  if (screen === 'portal') return <PortalScreen onKnockIdle={() => setScreen('home')} />;
  if (screen === 'home') return <><KnockRadio /><HomeScreen onWiki={() => setScreen('wiki')}
    onAccount={() => { setAfterAuth('account'); setScreen(storedToken() ? 'account' : 'auth'); }}
    onPlay={() => { void enterGame(); }} /></>;
  if (screen === 'wiki') return <WikiScreen onHome={() => setScreen('home')} onPlay={() => { void enterGame(); }} />;
  if (screen === 'account') return <AccountScreen onHome={() => setScreen('home')} onPlay={() => { void enterGame(); }} onLogout={logout} />;
  if (screen === 'boot') return <div className="auth-page"><div className="auth-page-bg" aria-hidden /><div className="auth-page-vignette" aria-hidden /><div className="splash auth-card-enter"><h1>KNOCK <span>HUNT BR</span></h1>
    {entryError ? <><p role="alert">{entryError}</p><button className="btn gold" onClick={() => { void enterGame(); }}>Tentar novamente</button><button className="btn" onClick={() => setScreen('home')}>Voltar</button></> : <p>{t('boot')}</p>}
  </div></div>;
  if (screen === 'auth') return <AuthScreen onReady={() => { if (afterAuth === 'account') setScreen('account'); else void enterGame(); }} />;
  if (screen === 'create') return <CreateCharacterScreen account={account} onEnter={enterCharacter}
    onRefresh={async () => { await loadRoster(); }} onLogout={logout} />;
  if (!character) return null;
  return <>
    {hadSocket && socketStatus !== 'open' && <div className="lost-link">{t('connectionLost')}</div>}
    <GameScreen character={character} settlement={settlement} guest={account?.guest}
      onBack={() => { setCharacter(null); setSettlement(null); setScreen('home'); }}
      onCharacter={(next, nextSettlement) => { setCharacter(next); if (nextSettlement !== undefined) setSettlement(nextSettlement); }}
      onClaimed={() => { void loadRoster(); }} />
  </>;
}