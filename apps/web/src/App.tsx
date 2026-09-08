import { useEffect, useState } from 'react';
import { api, LiveSocket, storeToken, storedToken } from './api/client.js';
import type { AccountView, CharacterView, Settlement } from './api/types.js';
import { useLocale } from './i18n/Locale.js';
import { AuthScreen } from './screens/AuthScreen.js';
import { GameScreen } from './screens/GameScreen.js';
import { SelectScreen } from './screens/SelectScreen.js';

type Screen = 'boot' | 'auth' | 'select' | 'game';

export function App() {
  const { t } = useLocale();
  const [screen, setScreen] = useState<Screen>('boot');
  const [characters, setCharacters] = useState<CharacterView[]>([]);
  const [account, setAccount] = useState<AccountView | null>(null);
  const [character, setCharacter] = useState<CharacterView | null>(null);
  const [settlement, setSettlement] = useState<Settlement | null>(null);
  const [socketStatus, setSocketStatus] = useState<'connecting' | 'open' | 'closed'>('closed');
  const [hadSocket, setHadSocket] = useState(false);

  async function loadRoster() {
    const payload = await api.characters();
    setCharacters(payload.characters);
    setAccount(payload.account ?? null);
    return payload.characters;
  }

  useEffect(() => {
    if (!storedToken()) {
      setScreen('auth');
      return;
    }
    void loadRoster()
      .then(() => setScreen('select'))
      .catch(() => {
        storeToken(null);
        setScreen('auth');
      });
  }, []);

  useEffect(() => {
    if (screen !== 'game' || !character) return;
    const socket = new LiveSocket(
      character.id,
      (next, nextSettlement) => {
        setCharacter(next);
        setSettlement(nextSettlement);
      },
      (status) => {
        setSocketStatus(status);
        if (status === 'open') setHadSocket(true);
      },
    );
    return () => {
      socket.close();
      setSocketStatus('closed');
      setHadSocket(false);
    };
  }, [screen, character?.id]);

  if (screen === 'boot') {
    return (
      <div className="auth-page">
        <div className="auth-page-bg" aria-hidden />
        <div className="auth-page-vignette" aria-hidden />
        <div className="splash auth-card-enter">
          <h1>TIBIA <span>IDLE</span></h1>
          <p>{t('boot')}</p>
        </div>
      </div>
    );
  }

  if (screen === 'auth') {
    return (
      <AuthScreen
        onReady={() => {
          void loadRoster().then(() => setScreen('select'));
        }}
      />
    );
  }

  if (screen === 'select') {
    return (
      <SelectScreen
        characters={characters}
        account={account}
        onEnter={(id) => {
          void api.character(id).then((payload) => {
            setCharacter(payload.character);
            setSettlement(payload.settlement);
            setScreen('game');
          });
        }}
        onRefresh={async () => {
          await loadRoster();
        }}
        onLogout={() => {
          void api.logout();
          storeToken(null);
          setScreen('auth');
        }}
      />
    );
  }

  if (!character) return null;

  return (
    <>
      {hadSocket && socketStatus !== 'open' && (
        <div className="lost-link">{t('connectionLost')}</div>
      )}
      <GameScreen
        character={character}
        settlement={settlement}
        guest={account?.guest}
        onBack={() => {
          void (async () => {
            if (character.session || character.queue) {
              try {
                await api.stopHunt(character.id);
              } catch {
                // Hunt may have ended already.
              }
            }
            await loadRoster();
            setScreen('select');
          })();
        }}
        onCharacter={(next, nextSettlement) => {
          setCharacter(next);
          if (nextSettlement !== undefined) setSettlement(nextSettlement);
        }}
        onClaimed={() => {
          void loadRoster();
        }}
      />
    </>
  );
}
