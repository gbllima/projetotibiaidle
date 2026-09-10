import { useEffect, useState } from 'react';
import { api, LiveSocket, storeToken, storedToken } from './api/client.js';
import type { AccountView, CharacterView, Settlement } from './api/types.js';
import { useLocale } from './i18n/Locale.js';
import { AuthScreen } from './screens/AuthScreen.js';
import { GameScreen } from './screens/GameScreen.js';
import { SelectScreen } from './screens/SelectScreen.js';
import { HomeScreen } from './screens/HomeScreen.js';
import { PartyCharacterSelector } from './components/PartyCharacterSelector.js';

type Screen = 'home' | 'boot' | 'auth' | 'select' | 'game';

export function App() {
  const { t } = useLocale();
  const [screen, setScreen] = useState<Screen>('home');
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
    if (screen !== 'home') return;
    if (!storedToken()) return;
    void loadRoster().catch(() => storeToken(null));
  }, [screen]);

  useEffect(() => {
    if (screen !== 'game' || !character) return;
    const socket = new LiveSocket(character.id, (next, nextSettlement) => {
      setCharacter(next);
      setSettlement(nextSettlement);
    }, (status) => {
      setSocketStatus(status);
      if (status === 'open') setHadSocket(true);
    });
    return () => {
      socket.close();
      setSocketStatus('closed');
      setHadSocket(false);
    };
  }, [screen, character?.id]);

  if (screen === 'home') {
    return <HomeScreen onPlay={() => {
      if (!storedToken()) setScreen('auth');
      else void loadRoster().then(() => setScreen('select')).catch(() => { storeToken(null); setScreen('auth'); });
    }} />;
  }

  if (screen === 'boot') {
    return <div className="auth-page"><div className="auth-page-bg" aria-hidden /><div className="auth-page-vignette" aria-hidden /><div className="splash auth-card-enter"><h1>TIBIA <span>IDLE</span></h1><p>{t('boot')}</p></div></div>;
  }

  if (screen === 'auth') {
    return <AuthScreen onReady={() => { void loadRoster().then(() => setScreen('select')); }} />;
  }

  if (screen === 'select') {
    return <SelectScreen characters={characters} account={account}
      onEnter={(id) => { void api.character(id).then((payload) => { setCharacter(payload.character); setSettlement(payload.settlement); setScreen('game'); }); }}
      onRefresh={async () => { await loadRoster(); }}
      onLogout={() => { void api.logout(); storeToken(null); setScreen('home'); }} />;
  }

  if (!character) return null;

  const addPartyCharacter = async (characterId: number) => {
    if (!character.session?.huntId) throw new Error('Entre em uma cave primeiro.');
    await api.addPartyMember(character.id, characterId);
    await api.startHunt(characterId, character.session.huntId, 1);
    await loadRoster();
    const refreshed = await api.character(character.id);
    setCharacter(refreshed.character); setSettlement(refreshed.settlement);
  };

  const createAndAddPartyCharacter = async (input: { name: string; vocationId: number; gender: 'm' | 'f'; weapon: 'axe' | 'sword' | 'club' }) => {
    if (!character.session?.huntId) throw new Error('Entre em uma cave primeiro.');
    const created = await api.createCharacter(input.name, input.vocationId, { gender: input.gender, weapon: input.weapon });
    try {
      await api.addPartyMember(character.id, created.character.id);
      await api.startHunt(created.character.id, character.session.huntId, 1);
    } finally {
      await loadRoster();
      const refreshed = await api.character(character.id);
      setCharacter(refreshed.character); setSettlement(refreshed.settlement);
    }
    return created.character.id;
  };

  return <>
    {hadSocket && socketStatus !== 'open' && <div className="lost-link">{t('connectionLost')}</div>}
    <GameScreen character={character} settlement={settlement} guest={account?.guest}
      onBack={() => { void (async () => { if (character.session || character.queue) { try { await api.stopHunt(character.id); } catch {} } await loadRoster(); setScreen('select'); })(); }}
      onCharacter={(next, nextSettlement) => { setCharacter(next); if (nextSettlement !== undefined) setSettlement(nextSettlement); }}
      onClaimed={() => { void loadRoster(); }} />
    <PartyCharacterSelector characters={characters} account={account} currentCharacterId={character.id}
      partySlots={character.partySlots ?? 1} currentHuntId={character.session?.huntId ?? null}
      onAdd={addPartyCharacter} onCreate={createAndAddPartyCharacter} />
  </>;
}
