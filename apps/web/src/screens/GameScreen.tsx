import { CITY_MERCHANT } from '@tibia-idle/data';
import { PartyManagerModal } from '../components/PartyManagerModal.js';
import { PartyMemberModal } from '../components/PartyMemberModal.js';
import { useEffect, useMemo, useRef, useState } from 'react';
import { huntsById, itemsById } from '@tibia-idle/data';
import { ApiError, api, storeToken } from '../api/client.js';
import type { BossView, CharacterView, HuntView, Settlement, WorldView } from '../api/types.js';
import { ActionBar } from '../components/ActionBar.js';
import { CombatScene } from '../components/CombatScene.js';
import { HelperModal } from '../components/HelperModal.js';
import { HuntModal } from '../components/HuntModal.js';
import { TrainingScene } from '../components/TrainingScene.js';
import { CityLobby } from '../components/CityLobby.js';
import { trainingRoom } from '../trainingRooms.js';
import { LeftDock } from '../components/LeftDock.js';
import { RightDock } from '../components/RightDock.js';
import { SystemsPanel } from '../components/SystemsPanel.js';
import { TopNav, type OverlayId } from '../components/TopNav.js';
import { WindowHead } from '../components/WindowHead.js';
import { formatCombatLog, hotbarSpells, type CombatLogLine, type ExerciseSkill } from '@tibia-idle/sim';
import type { ChatMessage } from '../api/types.js';
import { Onboarding } from '../components/Onboarding.js';
import { OutfitModal, type OutfitDraft } from '../components/OutfitModal.js';
import { formatDuration, formatNumber, xpProgress } from '../format.js';
import { useLocale } from '../i18n/Locale.js';
import { usePredictedCharacter } from '../live/predict.js';

type PolicyView = CharacterView['policy'];

function applyPolicyPatch(view: CharacterView, patch: Record<string, unknown>): CharacterView | null {
  if (patch.helperReset === true || patch.helperCopyFrom === 'hunt') return null;
  const mode = patch.helperMode === 'boss' || patch.helperMode === 'pvp' ? patch.helperMode : 'hunt';
  const fields = { ...patch };
  delete fields.helperMode;
  delete fields.helperReset;
  delete fields.helperCopyFrom;
  if (mode === 'hunt') {
    return { ...view, policy: { ...view.policy, ...fields } as PolicyView };
  }
  const current = view.helperProfiles?.[mode] ?? view.policy;
  return {
    ...view,
    helperProfiles: {
      ...view.helperProfiles,
      [mode]: { ...current, ...fields } as PolicyView,
    },
  };
}

export function GameScreen({
  character: server,
  settlement,
  guest,
  onBack,
  onCharacter,
  onClaimed,
}: {
  character: CharacterView;
  settlement: Settlement | null;
  guest?: boolean;
  onBack: () => void;
  onCharacter: (next: CharacterView, settlement?: Settlement | null) => void;
  onClaimed?: () => void;
}) {
  const { t, locale, setLocale } = useLocale();
  const { character, events } = usePredictedCharacter(server);
  const [overlay, setOverlay] = useState<OverlayId>('none');
  const [helperSection, setHelperSection] = useState<'cura' | 'magias'>('cura');
  const [settings, setSettings] = useState(false);
  const [replayTutorial, setReplayTutorial] = useState(false);
  const [dismissedTutorial, setDismissedTutorial] = useState<number | null>(null);
  const [pickingHunt, setPickingHunt] = useState(false);
  const [huntModalTab, setHuntModalTab] = useState<'hunts' | 'training'>('hunts');
  const [trainingRoomId, setTrainingRoomId] = useState<string | null>(
    () => localStorage.getItem('tibia-idle.training-room'),
  );
  const [outfitOpen, setOutfitOpen] = useState(false);
  const [partyConfigOpen, setPartyConfigOpen] = useState(false);
  const [partyMemberModal, setPartyMemberModal] = useState<{ id: number; mode: 'items' | 'appearance' } | null>(null);
  const [helperCharacter, setHelperCharacter] = useState<CharacterView | null>(null);
  const [huntError, setHuntError] = useState('');
  const [hunts, setHunts] = useState<HuntView[]>([]);
  const [bosses, setBosses] = useState<BossView[]>([]);
  const [lobbyPlayers, setLobbyPlayers] = useState<Awaited<ReturnType<typeof api.lobby>>['players']>([]);
  const bossesByHuntId = useMemo(() => new Map(bosses.map((boss) => [boss.huntId, boss])), [bosses]);
  const huntLabel = (huntId: string) => huntsById.get(huntId)?.name ?? bossesByHuntId.get(huntId)?.name ?? huntId;
  const [busy, setBusy] = useState(false);
  const [loop, setLoop] = useState(() => localStorage.getItem('tibia-idle.loop') !== '0');
  const lastHunt = useRef<string | null>(null);
  const lastHours = useRef(1);
  const userStopped = useRef(false);
  const bestiaryTold = useRef(false);
  const [chatTab, setChatTab] = useState('geral');
  const [log, setLog] = useState<CombatLogLine[]>(() => [{ kind: 'sys', text: t('welcome') }]);
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [worldEvent, setWorldEvent] = useState<WorldView['event'] | null>(null);
  const [boosted, setBoosted] = useState<WorldView['boosted']>(null);
  const [draft, setDraft] = useState('');
  const [banner, setBanner] = useState<string | null>(null);
  const [away, setAway] = useState<Settlement | null>(null);
  const [huntEnd, setHuntEnd] = useState<{
    reason: string;
    death?: NonNullable<Settlement['deathPenalty']>;
  } | null>(null);
  const liveDeath = useRef<NonNullable<Settlement['deathPenalty']> | null>(null);
  const [claimUser, setClaimUser] = useState('');
  const [claimPass, setClaimPass] = useState('');
  const lastWave = useRef<number | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  function enterTraining(roomId: string) {
    setTrainingRoomId(roomId);
    setOverlay('none');
    localStorage.setItem('tibia-idle.training-room', roomId);
    const room = trainingRoom(roomId);
    pushLog(room ? `Entrou em ${room.name}.` : 'Sala de treino.');
  }

  function goCity() {
    userStopped.current = true;
    lastHunt.current = null;
    leaveTraining();
    setPickingHunt(false);
    setOverlay('none');
    void act(async () => {
      for (const id of server.partyMemberIds ?? [server.id]) {
        const current = (await api.character(id)).character;
        if (current.session || current.queue) await api.stopHunt(id);
      }
      onCharacter((await api.character(server.id)).character);
    });
  }

  function leaveTraining() {
    setTrainingRoomId(null);
    localStorage.removeItem('tibia-idle.training-room');
    pushLog('Saiu do treino online.');
  }

  useEffect(() => {
    void api.hunts(character.id).then((payload) => setHunts(payload.hunts)).catch(() => undefined);
    void api.bosses(character.id).then((payload) => setBosses(payload.bosses)).catch(() => undefined);
  }, [character.id, character.level, pickingHunt]);

  useEffect(() => {
    let cancelled = false;
    if (character.session || trainingRoomId) return;
    let inFlight = false;
    const refresh = () => {
      if (inFlight) return;
      inFlight = true;
      void api.lobby(character.id).then((payload) => {
        if (!cancelled) setLobbyPlayers(payload.players);
      }).catch(() => undefined).finally(() => { inFlight = false; });
    };
    refresh();
    const timer = window.setInterval(refresh, 500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [character.id, Boolean(character.session), trainingRoomId]);

  useEffect(() => {
    const serverChannel = chatTab === 'combat' || chatTab === 'loot'
      ? 'geral'
      : chatTab === 'comunicados'
        ? 'comunicados'
        : chatTab;
    void api.world(serverChannel).then((world) => {
      if (chatTab !== 'combat' && chatTab !== 'loot') setChat(world.chat);
      setWorldEvent(world.event);
      setBoosted(world.boosted ?? null);
    }).catch(() => undefined);
  }, [chatTab, character.id]);

  const trainingExercise = (server.exerciseCharges ?? 0) > 0;
  const trainingIntervalMs = trainingExercise ? 2000 : 8000;
  const trainingTickBusy = useRef(false);

  useEffect(() => {
    if (!trainingRoomId || server.session || server.queue) return;

    const tick = () => {
      if (trainingTickBusy.current) return;
      trainingTickBusy.current = true;
      void api.act(server.id, {
        type: 'train-online',
        elapsedMs: trainingIntervalMs,
      }).then((result) => {
        onCharacter(result.character);
        const gained = Number(result.gained ?? 0);
        if (gained > 0) {
          const skill = result.character.dummySkill ?? server.dummySkill;
          const exercise = (result.character.exerciseCharges ?? 0) > 0;
          pushLog(`Treino: +${gained.toLocaleString('pt-BR')} ${skill}${exercise ? ' (exercise)' : ''}.`);
        }
      }).catch(() => undefined).finally(() => {
        trainingTickBusy.current = false;
      });
    };

    const timer = window.setInterval(tick, trainingIntervalMs);
    return () => window.clearInterval(timer);
  }, [trainingRoomId, server.id, server.session, server.queue, trainingIntervalMs, onCharacter]);

  useEffect(() => {
    if (!settlement) return;
    if (settlement.elapsedSeconds >= 60) {
      setAway(settlement);
      pushLog(`${t('awayTitle')}: ${formatDuration(settlement.elapsedSeconds)}.`);
    } else if (settlement.stoppedBecause) {
      setHuntEnd({
        reason: settlement.stoppedBecause,
        death: settlement.deathPenalty ?? liveDeath.current ?? undefined,
      });
      liveDeath.current = null;
    }
    if (settlement.stoppedBecause) {
      pushLog(`Hunt encerrada: ${settlement.stoppedBecause.replaceAll('_', ' ')}.`);
    }
  }, [settlement]);

  useEffect(() => {
    localStorage.setItem('tibia-idle.loop', loop ? '1' : '0');
  }, [loop]);

  useEffect(() => {
    if (character.session?.huntId) lastHunt.current = character.session.huntId;
  }, [character.session?.huntId]);

  useEffect(() => {
    if (character.session || character.queue || !loop || userStopped.current || busy) return;
    const huntId = lastHunt.current;
    if (!huntId) return;
    lastHunt.current = null;
    void act(() => api.startHunt(character.id, huntId, lastHours.current).then((result) => {
      onCharacter(result.character);
      if (result.character.queue) pushLog(t('queueWait'));
      else pushLog(`${t('loop')}: ${huntLabel(huntId)}.`);
    }));
  }, [character.session, character.queue, loop]);

  useEffect(() => {
    for (const event of events) {
      if (event.type === 'level_up' && event.level) {
        setBanner(`Level ${event.level}!`);
        window.setTimeout(() => setBanner(null), 2200);
      }
      if (event.type === 'player_death') {
        liveDeath.current = {
          lost: event.amount ?? 0,
          blessingsUsed: event.level ?? 0,
          rate: 0,
          aolUsed: event.itemId === 3057,
          pouchLost: event.count ?? 0,
          skillsLost: Number(event.skill ?? 0) || 0,
        };
      }
    }
    const lines = formatCombatLog(events, locale);
    if (lines.length) setLog((current) => [...current, ...lines].slice(-48));
  }, [events, locale]);

  useEffect(() => {
    const wave = character.session?.wave;
    if (!wave || lastWave.current === null) {
      lastWave.current = wave ?? null;
      return;
    }
    if (wave !== lastWave.current) {
      const clearedPhase = lastWave.current === 10 && wave === 1;
      const boss = wave === 10 || character.session?.bossWave;
      const text = clearedPhase ? t('wavePhaseClear') : boss ? t('bossWave') : `Wave ${lastWave.current}/10 concluída!`;
      setBanner(text);
      pushLog(text);
      window.setTimeout(() => setBanner(null), 2200);
      lastWave.current = wave;
    }
  }, [character.session?.wave]);

  useEffect(() => {
    const kills = Object.values(character.bestiary ?? {}).reduce((sum, n) => sum + n, 0);
    if (bestiaryTold.current || kills < 10) return;
    bestiaryTold.current = true;
    pushLog(t('bestiaryUnlock'));
  }, [character.bestiary]);

  const hunt = character.session
    ? huntsById.get(character.session.huntId) ?? bossesByHuntId.get(character.session.huntId)
    : character.queue
      ? huntsById.get(character.queue.huntId) ?? bossesByHuntId.get(character.queue.huntId)
      : null;
  const wavesTotal = character.session?.wavesTotal ?? 10;
  const wavesCleared = character.session?.wavesCleared ?? 0;

  useEffect(() => {
    const node = logRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [log, chat]);

  function pushLog(line: string) {
    setLog((current) => [...current, { kind: 'sys' as const, text: line }].slice(-48));
  }

  async function act(work: () => Promise<void>) {
    setBusy(true);
    try {
      await work();
    } catch (error) {
      pushLog(error instanceof ApiError ? error.message : 'Algo deu errado.');
    } finally {
      setBusy(false);
    }
  }

  function savePolicy(patch: Record<string, unknown>) {
    const optimistic = applyPolicyPatch(server, patch);
    if (optimistic) onCharacter(optimistic);
    void act(() => api.act(character.id, { type: 'policy', ...patch }).then((result) => onCharacter(result.character)));
  }

  function savePartyPolicy(characterId: number, patch: Record<string, unknown>) {
    if (characterId === character.id) {
      savePolicy(patch);
      return;
    }
    void act(() => api.act(characterId, { type: 'policy', ...patch }).then((result) => {
      if (result.targetCharacter) {
        setHelperCharacter(result.targetCharacter);
      }
      return api.character(character.id).then((current) => onCharacter(current.character));
    }));
  }

  function saveHelperPolicy(patch: Record<string, unknown>) {
    if (!helperCharacter) return;
    const optimistic = applyPolicyPatch(helperCharacter, patch);
    if (optimistic) setHelperCharacter(optimistic);
    void act(() => api.act(helperCharacter.id, { type: 'policy', ...patch }).then((result) => setHelperCharacter(result.character)));
  }

  function openPartyHelper(characterId: number) {
    setHelperCharacter(null);
    void act(() => api.character(characterId).then((result) => setHelperCharacter(result.character)));
  }

  function toggle(id: OverlayId) {
    if (id === 'helper') setHelperSection('cura');
    setOverlay((current) => (current === id ? 'none' : id));
  }

  function openHelperSpells() {
    setHelperSection('magias');
    setOverlay('helper');
  }

  return (
    <div className="shell">
      {(((server.onboardingStep ?? 0) < 99 && dismissedTutorial !== server.id) || replayTutorial) && (
        <Onboarding
          key={server.id}
          character={server}
          guest={guest}
          replay={replayTutorial}
          helperOpen={overlay === 'helper' || Boolean(helperCharacter)}
          huntsOpen={pickingHunt}
          gameBusy={busy}
          onSave={async (step) => {
            const result = await api.act(server.id, { type: 'onboard', step });
            onCharacter(result.character);
          }}
          onClose={() => { setDismissedTutorial(server.id); setReplayTutorial(false); }}
          onCloseHelper={() => { setOverlay('none'); setHelperCharacter(null); }}
          onOpenHelper={() => { setHelperSection('cura'); setOverlay('helper'); }}
          onOpenHunts={() => { setHuntError(''); setHuntModalTab('hunts'); setPickingHunt(true); }}
        />
      )}
      <TopNav
        onCity={goCity}
        onTraining={() => { setHuntModalTab('training'); setPickingHunt(true); }}
        name={character.name}
        gold={character.gold}
        coins={character.coins}
        health={character.health}
        maxHealth={character.maxHealth}
        mana={character.mana}
        maxMana={character.maxMana}
        level={character.level}
        xpPercent={xpProgress(character.level, character.experience).percent}
        stamina={character.stamina}
        overlay={overlay}
        onOverlay={toggle}
        onBack={onBack}
        onSettings={() => setSettings(true)}
        badges={{
          helper: character.policy?.autoAttack === false ? '!' : undefined,
        }}
      />

      <div className="board">
        <LeftDock
          character={character}
          busy={busy}
          onTaskRoll={() => void act(() => api.act(character.id, { type: 'task-roll' }).then((r) => onCharacter(r.character)))}
        />

        <main className="center">
          <div className="center-head">
            {boosted && (
              <div className="event-bar">
                {t('boostedCreature')}: {boosted.name} · XP ×1.5 · loot ×1.25
              </div>
            )}
            {worldEvent && (worldEvent.experience !== 1 || worldEvent.loot !== 1 || worldEvent.name) && (
              <div className="event-bar">
                {worldEvent.name || t('worldEvent')} · XP ×{worldEvent.experience} · loot ×{worldEvent.loot}
              </div>
            )}
            <div className="arena-head">
            <button className="hunt-pick" data-tutorial="hunts" onClick={() => { setHuntError(''); setPickingHunt(true); }}>
              {hunt?.name ?? t('hunts')}
              <small>▾</small>
            </button>
            <div className={`wave ${character.session?.bossWave ? 'boss' : ''}`}>
              <div className="label">
                {character.session?.bossWave ? t('bossWave') : `Wave ${character.session?.wave ?? 0}/${wavesTotal}`}
                {character.session ? ` · ${character.session.packAlive ?? character.session.active.length}/${character.session.packSize}` : ''}
              </div>
              <div className="waves">
                {Array.from({ length: wavesTotal }, (_, index) => (
                  <i
                    key={index}
                    className={`${index < (wavesCleared % wavesTotal) ? 'on' : ''} ${index === wavesTotal - 1 ? 'skull' : ''} ${character.session?.bossWave && index === wavesTotal - 1 ? 'now' : ''}`}
                  />
                ))}
              </div>
            </div>
            <button className={`loop ${loop ? 'on' : ''}`} onClick={() => setLoop(!loop)}>{t('loop')}</button>
          </div>
          </div>

          {character.session ? (
            <div className="viewport">
              <CombatScene
                key={character.id}
                characterId={character.id}
                huntId={character.session.huntId}
                active={character.session.active}
                events={[...events, ...(character.partyEvents ?? [])]}
                decorations={character.decorations}
                allies={[
                  ...(character.caveParty ?? []).filter((mate) => !mate.self).map((mate) => ({
                    id: mate.id,
                    name: mate.name,
                    vocationId: mate.vocationId,
                    health: mate.health ?? 1,
                    maxHealth: mate.maxHealth ?? 1,
                    mana: mate.mana ?? 0,
                    maxMana: mate.maxMana ?? 1,
                    appearance: mate.appearance,
                  })),
                  ...(character.session.summons ?? []).map((summon) => ({
                    name: summon.name,
                    vocationId: 0,
                    health: 1,
                    maxHealth: 1,
                    mana: 0,
                    maxMana: 1,
                    appearance: {
                      outfit: summon.lookType
                        ?? (summon.familiar ? 991 : 33),
                      head: 0, body: 0, legs: 0, feet: 0, addons: 0,
                    },
                  })),
                ]}
                player={{
                  name: character.name,
                  vocationId: character.vocation.id,
                  health: character.health,
                  maxHealth: character.maxHealth,
                  mana: character.mana,
                  maxMana: character.maxMana,
                  appearance: character.appearance,
                }}
              />
              {banner && <div className="banner">{banner}</div>}
              {guest && (character.onboardingStep ?? 0) >= 99 && (
                <form className="onboard claim-banner" onSubmit={(event) => {
                  event.preventDefault();
                  void act(async () => {
                    const result = await api.claim(claimUser.trim(), claimPass);
                    storeToken(result.token);
                    onClaimed?.();
                    pushLog(t('claimOk'));
                  });
                }}>
                  <p>{t('claimLede')}</p>
                  <input value={claimUser} onChange={(event) => setClaimUser(event.target.value)} placeholder={t('account')} autoComplete="username" />
                  <input type="password" value={claimPass} onChange={(event) => setClaimPass(event.target.value)} placeholder={t('password')} autoComplete="new-password" />
                  <button className="btn gold" disabled={busy} type="submit">{t('claim')}</button>
                </form>
              )}
            </div>
          ) : (
            <div className="viewport">
              {character.queue ? (
                <div className="queue-card">
                  <div className="panel">
                    <h2>{t('queueTitle')}</h2>
                    <p>{t('queueWait')}</p>
                    <div className="queue-pos">{character.queue.position}/{character.queue.size}</div>
                    <p>{hunt?.name ?? character.queue.huntId}</p>
                    <button className="btn danger" disabled={busy} onClick={() => void act(() => api.stopHunt(character.id).then((result) => {
                      userStopped.current = true;
                      lastHunt.current = null;
                      onCharacter(result.character);
                      pushLog(t('leaveQueue'));
                    }))}>{t('leaveQueue')}</button>
                  </div>
                </div>
              ) : trainingRoomId ? (
                <div className="viewport training-viewport">
                  <TrainingScene
                    roomId={trainingRoomId}
                    attackMs={trainingIntervalMs}
                    exerciseMode={trainingExercise}
                    dummySkill={server.dummySkill as ExerciseSkill}
                    supplies={server.supplies}
                    player={{
                      name: character.name,
                      vocationId: character.vocation.id,
                      health: character.health,
                      maxHealth: character.maxHealth,
                      mana: character.mana,
                      maxMana: character.maxMana,
                      appearance: character.appearance,
                    }}
                  />
                  <div className="training-hud">
                    <div className="training-hud-card">
                      <h2>{trainingRoom(trainingRoomId)?.name ?? 'Treino online'}</h2>
                      <p>
                        Treinando <b>{server.dummySkill}</b>
                        {trainingExercise
                          ? ` · exercise · ${server.exerciseCharges ?? 0} cargas · +7 / 2s`
                          : ' · dummy livre · +1 / 8s'}
                      </p>
                      <p className="dummy-hint">
                        Supply pouch: {server.supplies.filter((s) => s.count > 0).length} stacks
                        {(server.exerciseCharges ?? 0) === 0 && server.supplies.some((s) => s.count > 0)
                          ? ' · compre exercise na Loja (TC) compatível com sua skill'
                          : ''}
                      </p>
                      {server.lastDummyTries > 0 && (
                        <p className="dummy-hint">Último ganho: {server.lastDummyTries.toLocaleString('pt-BR')} tries</p>
                      )}
                      <div className="row" style={{ marginTop: 10 }}>
                        <button className="btn gold" type="button" onClick={() => { setHuntError(''); setHuntModalTab('training'); setPickingHunt(true); }}>
                          Trocar sala
                        </button>
                        <button className="btn ghost" type="button" onClick={leaveTraining}>
                          Sair
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <CityLobby
                  players={lobbyPlayers.length > 0 ? lobbyPlayers : [{
                    id: character.id,
                    name: character.name,
                    level: character.level,
                    vocationId: character.vocation.id,
                    appearance: character.appearance,
                    active: true,
                  }]}
                  selfId={character.id}
                  scene={(
                    !lobbyPlayers.some((entry) => entry.id === character.id) ? <p className="lede">Entrando na cidade…</p> : <CombatScene
                      key={`city-${character.id}`}
                      characterId={character.id}
                      huntId="city-lobby"
                      cityLobby
                      onCityMerchant={() => setOverlay('market')}
                      onCityMove={async ({ x, y }) => {
                        try { return await api.cityMove(character.id, x, y); }
                        catch (error) { pushLog('Não foi possível mover na cidade. Tente novamente.'); throw error; }
                      }}
                      active={[]}
                      events={[]}
                      player={{
                        cityPosition: lobbyPlayers.find((entry) => entry.id === character.id)?.cityPosition,
                        name: character.name,
                        vocationId: character.vocation.id,
                        health: character.health,
                        maxHealth: character.maxHealth,
                        mana: character.mana,
                        maxMana: character.maxMana,
                        appearance: character.appearance,
                      }}
                      allies={[
                        ...lobbyPlayers.filter((player) => player.id !== character.id).map((player) => ({
                          id: player.id,
                          cityPosition: player.cityPosition,
                          name: player.name,
                          vocationId: player.vocationId,
                          health: 1,
                          maxHealth: 1,
                          mana: 0,
                          maxMana: 1,
                          appearance: player.appearance,
                        })),
                        {
                          name: 'Mercador',
                          cityNpc: 'merchant',
                          cityPosition: CITY_MERCHANT,
                          vocationId: 4,
                          health: 1,
                          maxHealth: 1,
                          mana: 0,
                          maxMana: 1,
                          appearance: { outfit: 128, head: 0, body: 0, legs: 0, feet: 0, aura: 0, mount: 0, addons: 0 },
                        },
                      ]}
                    />
                  )}
                  onHunt={() => { setHuntError(''); setHuntModalTab('hunts'); setPickingHunt(true); }}
                  onTraining={() => { setHuntError(''); setHuntModalTab('training'); setPickingHunt(true); }}
                />
              )}
              {guest && (character.onboardingStep ?? 0) >= 99 && (
                <form className="onboard claim-banner" onSubmit={(event) => {
                  event.preventDefault();
                  void act(async () => {
                    const result = await api.claim(claimUser.trim(), claimPass);
                    storeToken(result.token);
                    onClaimed?.();
                    pushLog(t('claimOk'));
                  });
                }}>
                  <p>{t('claimLede')}</p>
                  <input value={claimUser} onChange={(event) => setClaimUser(event.target.value)} placeholder={t('account')} autoComplete="username" />
                  <input type="password" value={claimPass} onChange={(event) => setClaimPass(event.target.value)} placeholder={t('password')} autoComplete="new-password" />
                  <button className="btn gold" disabled={busy} type="submit">{t('claim')}</button>
                </form>
              )}
            </div>
          )}

          <div className="bottom-console">
            <div className="chat-console">
              <div className="chat-console__head">
                <div className="chat-console__tabs">
                  {([['geral', 'Geral'], ['combat', 'Log de combat'], ['loot', 'Loot'], ['comunicados', 'Comunicados'], ['help', 'Help'], ['market', 'Market']] as const).map(([id, label]) => (
                    <button key={id} type="button" className={chatTab === id ? 'on' : ''} onClick={() => setChatTab(id)}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="chat-console__log" ref={logRef}>
                {chatTab === 'combat' && log.filter((line) => line.kind !== 'loot').map((line, index) => (
                  <div key={`combat-${index}`} className={`chat-line ${line.kind}`}>{line.text}</div>
                ))}
                {chatTab === 'loot' && log.filter((line) => line.kind === 'loot').map((line, index) => (
                  <div key={`loot-${index}`} className={`chat-line ${line.kind}`}>{line.text}</div>
                ))}
                {chatTab === 'help' && (
                  <>
                    <div className="chat-line sys">{t('help1')}</div>
                    <div className="chat-line sys">{t('help2')}</div>
                    <div className="chat-line sys">{t('help3')}</div>
                    <div className="chat-line sys">{t('help4')}</div>
                    <div className="chat-line sys">{t('help5')}</div>
                    <div className="chat-line sys">{t('help6')}</div>
                    <div className="chat-line sys">{t('help7')}</div>
                    <div className="chat-line sys">{t('help8')}</div>
                  </>
                )}
                {chatTab !== 'help' && chatTab !== 'combat' && chatTab !== 'loot' && chat.map((message) => (
                  <div key={message.id} className="chat-line say"><b>{message.author}</b> {message.body}</div>
                ))}
              </div>
              {chatTab !== 'combat' && chatTab !== 'loot' && chatTab !== 'help' && (
                <form
                  className="chat-console__input"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const text = draft.trim();
                    if (!text) return;
                    setDraft('');
                    const channel = chatTab === 'comunicados' ? 'geral' : chatTab;
                    void act(() => api.act(character.id, { type: 'chat', channel, body: text }).then((result) => {
                      onCharacter(result.character);
                      return api.world(channel).then((world) => setChat(world.chat));
                    }));
                  }}
                >
                  <input
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    placeholder={t('chatPh')}
                    maxLength={200}
                  />
                  <button type="submit" className="chat-console__send" title="Enviar" disabled={busy || !draft.trim()}>
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.4 20.4 22 12 3.4 3.6l2.8 7.2L17 11l-7.2 1.2-2.8 7.2z" /></svg>
                  </button>
                </form>
              )}
            </div>

            <ActionBar
              character={character}
              spells={hotbarSpells(character.vocation.id, character.level, character.policy)}
              hint={t('hotbarHint')}
              spellsConfigLabel={t('openHelperSpells')}
              onOpenHelper={openPartyHelper}
              onOpenSpells={openHelperSpells}
              onAutoAttack={(characterId) => savePartyPolicy(characterId, {
                autoAttack: characterId === character.id
                  ? character.policy?.autoAttack === false
                  : character.caveParty.find((member) => member.id === characterId)?.policy?.autoAttack === false,
              })}
              onSpellPriority={(characterId, spell) => savePartyPolicy(characterId, {
                spellPriority: [spell.id, ...(character.caveParty.find((member) => member.id === characterId)?.policy?.spellPriority ?? []).filter((id) => id !== spell.id)],
                disabledSpells: (character.caveParty.find((member) => member.id === characterId)?.policy?.disabledSpells ?? []).filter((id) => id !== spell.id),
              })}
              onSpellToggle={(characterId, spell, disabled) => {
                const memberPolicy = characterId === character.id
                  ? character.policy
                  : character.caveParty.find((member) => member.id === characterId)?.policy;
                const disabledList = memberPolicy?.disabledSpells ?? [];
                savePartyPolicy(characterId, {
                  disabledSpells: disabled ? [...disabledList, spell.id] : disabledList.filter((id) => id !== spell.id),
                });
              }}
            />
          </div>
        </main>

        <RightDock
          character={server.session?.status === 'active' ? character : server}
          busy={busy}
          onSell={() => void act(() => api.sellPouch(character.id).then((r) => {
            onCharacter(r.character);
            pushLog(`Vendeu o loot por ${r.gold.toLocaleString('pt-BR')} gold.`);
          }))}
          onUpgrade={() => void act(() => api.upgradeGear(character.id).then((r) => onCharacter(r.character)))}
          onParty={(currency) => void act(() => api.act(character.id, { type: 'party-unlock', currency }).then((r) => onCharacter(r.character)))}
          onPartyConfig={() => setPartyConfigOpen(true)}
          onPartyItems={(id) => setPartyMemberModal({ id, mode: 'items' })}
          onPartyToggle={(id, active) => {
            if (!active && id === character.id) { setPickingHunt(true); return; }
            void act(async () => {
              if (active) await api.stopHunt(id);
              else if (character.session) await api.startHunt(id, character.session.huntId, 1);
              onCharacter((await api.character(character.id)).character);
            });
          }}
          onOutfit={(id) => setPartyMemberModal({ id, mode: 'appearance' })}
          onLootSlot={(currency) => void act(() => api.act(character.id, { type: 'loot-slot', currency }).then((r) => onCharacter(r.character)))}
          onSupplySlot={(currency) => void act(() => api.act(character.id, { type: 'supply-slot', currency }).then((r) => onCharacter(r.character)))}
          onLootFilter={(value) => savePolicy({ lootMinValue: value })}
          onEquip={(itemId, source, targetCharacterId) => void act(() => api.act(character.id, { type: 'equip', itemId, source, targetCharacterId }).then((r) => {
            onCharacter(r.character);
            const slot = typeof r.slot === 'string' ? r.slot : '';
            const name = itemsById.get(itemId)?.name ?? 'item';
            pushLog(slot ? `Equipou ${name} (${slot}).` : `Equipou ${name}.`);
          }))}
          onUnequip={(slot, targetCharacterId) => void act(() => api.act(character.id, { type: 'unequip', slot, targetCharacterId }).then((r) => onCharacter(r.character)))}
          onDestroyItem={(itemId, source, count, slot) => void act(() => api.act(character.id, { type: 'destroy-item', itemId, source, count, slot }).then((r) => onCharacter(r.character)))}
          onSellItem={(itemId, source, count) => void act(() => api.act(character.id, { type: 'sell-item', itemId, source, count }).then((r) => {
            onCharacter(r.character);
            const gold = typeof r['gold'] === 'number' ? r.gold : 0;
            if (gold) pushLog(`Vendeu por ${gold.toLocaleString('pt-BR')} gold.`);
          }))}
          onMoveItem={(itemId, source, count) => void act(() => api.act(character.id, { type: 'move-item', itemId, source, count }).then((r) => {
            onCharacter(r.character);
            pushLog('Item movido para a backpack.');
          }))}
          onBackpackWithdraw={(itemId, count, target) => void act(() => api.act(character.id, { type: 'backpack-withdraw', itemId, count, target }).then((r) => {
            onCharacter(r.character);
            pushLog(target === 'warehouse' ? 'Item movido pro armazém.' : 'Item movido pra supply pouch.');
          }))}
          onUseItem={(itemId, source) => void act(() => api.act(character.id, { type: 'use-item', itemId, source }).then((r) => {
            onCharacter(r.character);
            const msg = typeof r['message'] === 'string' ? r.message : 'Usou o item.';
            pushLog(msg);
          }))}
          onBlessing={(body) => act(() => api.act(character.id, { type: 'blessing', ...body }).then((r) => {
            onCharacter(r.character);
            pushLog('Bênção adquirida no templo.');
          }))}
        />
      </div>

      {(overlay === 'helper' || helperCharacter) && (
        <HelperModal
          key={`${helperCharacter?.id ?? character.id}-${helperSection}`}
          character={helperCharacter ?? character}
          busy={busy}
          initialSection={helperSection}
          onClose={() => { setOverlay('none'); setHelperCharacter(null); }}
          onPolicy={helperCharacter ? saveHelperPolicy : savePolicy}
        />
      )}

      {pickingHunt && (
        <HuntModal
          onCity={goCity}
          initialTab={huntModalTab}
          hunts={hunts}
          bosses={bosses}
          character={character}
          hunting={Boolean(character.session || character.queue)}
          busy={busy}
          error={huntError}
          onClose={() => setPickingHunt(false)}
          onStart={(huntId, hours) => void act(async () => {
            setHuntError('');
            lastHours.current = hours;
            lastHunt.current = huntId;
            try {
              const r = await api.startHunt(character.id, huntId, hours);
              userStopped.current = false;
              onCharacter(r.character);
              setPickingHunt(false);
              if (r.character.queue) pushLog(t('queueWait'));
              else pushLog(`${t('entered')} ${huntLabel(huntId)}.`);
            } catch (error) {
              const message = error instanceof ApiError ? error.message : t('huntError');
              setHuntError(message);
              throw error;
            }
          })}
          onStop={() => void act(() => api.stopHunt(character.id).then((r) => {
            userStopped.current = true;
            lastHunt.current = null;
            onCharacter(r.character);
            pushLog(`Hunt encerrada. +${r.goldBanked.toLocaleString('pt-BR')} gold.`);
            if (loop) setPickingHunt(true);
          }))}
          onEnterTraining={(roomId) => enterTraining(roomId)}
        />
      )}

      {partyConfigOpen && <PartyManagerModal character={server} onClose={() => setPartyConfigOpen(false)} onSaved={onCharacter} />}
      {partyMemberModal && <PartyMemberModal owner={server} memberId={partyMemberModal.id} mode={partyMemberModal.mode} onClose={() => setPartyMemberModal(null)} onCharacter={onCharacter} />}
      {outfitOpen && (
        <OutfitModal
          character={character}
          busy={busy}
          onClose={() => setOutfitOpen(false)}
          onApply={async (draft) => {
            setBusy(true);
            try {
              const result = await api.act(character.id, { type: 'appearance', ...draft });
              onCharacter(result.character);
              setOutfitOpen(false);
              pushLog(
                draft.mount > 0
                  ? 'Aparência atualizada — montaria equipada.'
                  : 'Aparência atualizada.',
              );
            } catch (error) {
              const message = error instanceof ApiError ? error.message : 'Falha ao aplicar aparência.';
              pushLog(message);
              throw error instanceof Error ? error : new Error(message);
            } finally {
              setBusy(false);
            }
          }}
          onPresetSave={(slot) => act(() => api.act(character.id, { type: 'preset-save', slot }).then((result) => {
            onCharacter(result.character);
            pushLog(`Preset ${slot + 1} salvo.`);
          }))}
          onPresetLoad={async (slot) => {
            let next: OutfitDraft | undefined;
            await act(async () => {
              const result = await api.act(character.id, { type: 'preset-load', slot });
              onCharacter(result.character);
              pushLog(`Preset ${slot + 1} carregado.`);
              const a = result.character.appearance;
              next = {
                outfit: a.outfit,
                head: a.head,
                body: a.body,
                legs: a.legs,
                feet: a.feet,
                addons: a.addons ?? 0,
                mount: a.mount ?? 0,
                aura: a.aura ?? 0,
              };
            });
            return next;
          }}
        />
      )}

      {overlay !== 'none' && overlay !== 'helper' && (
        <SystemsPanel
          overlay={overlay}
          character={character}
          busy={busy}
          onClose={() => setOverlay('none')}
          onAct={async (body) => {
            setBusy(true);
            try {
              const result = await api.act(character.id, body);
              onCharacter(result.character);
              if (typeof result['won'] === 'boolean') {
                pushLog(result['won'] ? `Arena: vitória +${result['gold']} gold.` : `Arena: derrota contra ${String(result['opponent'])}.`);
              }
              if (body.type === 'roleta-spin' && typeof result['itemName'] === 'string') {
                pushLog(`Roleta: ${result['itemName']} (Lv ${result['levelRequired']}) → Depot (−${result['cost']} TC).`);
              }
              if (body.type === 'exalt' && typeof result['success'] === 'boolean') {
                const slot = String(result['slot'] ?? body.slot ?? '');
                if (result['success']) {
                  pushLog(`Forja: sucesso em ${slot} → class ${result['tier']} (${result['successChance']}% · −${result['dustCost']} poeira${Number(result['coresSpent']) > 0 ? ` · −${result['coresSpent']} core` : ''}).`);
                } else if (result['tierLost']) {
                  pushLog(`Forja: falha em ${slot} — perdeu tier → class ${result['tier']}.`);
                } else {
                  pushLog(`Forja: falha em ${slot} — tier mantido (${result['tier']}).`);
                }
              }
              if (body.type === 'forge-convergence-fusion' && result['tier'] != null) {
                pushLog(`Forja Convergence: ${String(result['slot'])} → class ${result['tier']} (−${result['dustCost']} poeira · −${formatNumber(Number(result['cost']))}g).`);
              }
              if (body.type === 'forge-transfer' && result['receiveTier'] != null) {
                pushLog(
                  `Forja Transfer${result['convergence'] ? ' Convergence' : ''}: ${String(result['donorSlot'])} → ${String(result['receiveSlot'])} class ${result['receiveTier']} (−${result['dustCost']} poeira · −${result['coresSpent']} cores).`,
                );
              }
              return result;
            } catch (error) {
              pushLog(error instanceof ApiError ? error.message : 'Algo deu errado.');
              throw error;
            } finally {
              setBusy(false);
            }
          }}
        />
      )}

      {away && (
        <div className="modal" onClick={() => setAway(null)}>
          <div className="modal-card away" onClick={(event) => event.stopPropagation()}>
            <WindowHead title={t('awayTitle')} onClose={() => setAway(null)} closeLabel={t('close')} />
            <div className="modal-card-body">
            <p className="lede modal-lede-left">{formatDuration(away.elapsedSeconds)}</p>
            <div className="away-grid">
              <div><span>{t('awayXp')}</span><strong>{formatNumber(away.delta?.experience ?? 0)}</strong></div>
              <div><span>{t('awayKills')}</span><strong>{formatNumber(away.delta?.kills ?? 0)}</strong></div>
              <div><span>{t('awayLoot')}</span><strong>{formatNumber(away.delta?.lootValue ?? 0)}</strong></div>
              <div><span>{t('awaySupplies')}</span><strong>{formatNumber(away.delta?.supplyValue ?? 0)}</strong></div>
              <div><span>{t('awayLevels')}</span><strong>{away.delta?.levels ?? 0}</strong></div>
              <div>
                <span>{t('awayEfficiency')}</span>
                <strong>{Math.round((away.efficiency ?? 1) * 100)}%</strong>
              </div>
            </div>
            {away.discardedSeconds ? (
              <p className="lede modal-lede-left">{t('awayCap')}: {away.capHours ?? 8}h</p>
            ) : null}
            <button className="btn gold" style={{ width: '100%' }} onClick={() => setAway(null)}>{t('gotIt')}</button>
            </div>
          </div>
        </div>
      )}

      {huntEnd && !away && (
        <div className="modal" onClick={() => setHuntEnd(null)}>
          <div className="modal-card away" onClick={(event) => event.stopPropagation()}>
            <WindowHead title={t('huntEnded')} onClose={() => setHuntEnd(null)} closeLabel={t('close')} />
            <div className="modal-card-body">
            <p className="lede modal-lede-left">
              {huntEnd.reason === 'died' ? (
                <>
                  <strong>{t('endedDied')}</strong>
                  {huntEnd.death ? (
                    <span className="away-grid" style={{ display: 'grid', marginTop: 10, gap: 8 }}>
                      <div>
                        <span>{t('endedDiedXp')}</span>
                        <strong>{formatNumber(huntEnd.death.lost)}</strong>
                      </div>
                      {huntEnd.death.skillsLost > 0 ? (
                        <div>
                          <span>{t('endedDiedSkills')}</span>
                          <strong>{huntEnd.death.skillsLost}</strong>
                        </div>
                      ) : null}
                      {huntEnd.death.blessingsUsed > 0 ? (
                        <div>
                          <span>{t('endedDiedBlessings')}</span>
                          <strong>{huntEnd.death.blessingsUsed}</strong>
                        </div>
                      ) : null}
                    </span>
                  ) : null}
                  {huntEnd.death?.aolUsed ? (
                    <p style={{ marginTop: 10 }}>{t('endedDiedAol')}</p>
                  ) : null}
                  {(huntEnd.death?.pouchLost ?? 0) > 0 ? (
                    <p style={{ marginTop: 10 }}>
                      {formatNumber(huntEnd.death!.pouchLost)} gold {t('endedDiedLoot')}
                    </p>
                  ) : null}
                  <p style={{ marginTop: 10 }}>{t('endedDiedHint')}</p>
                </>
              ) : huntEnd.reason === 'fled' ? t('endedFled')
                : huntEnd.reason === 'out_of_supplies' ? t('endedSupplies')
                  : huntEnd.reason === 'no_stamina' ? t('endedStamina')
                    : t('endedStopped')}
            </p>
            <button className="btn gold" style={{ width: '100%' }} onClick={() => setHuntEnd(null)}>{t('gotIt')}</button>
            </div>
          </div>
        </div>
      )}

      {settings && (
        <div className="modal" onClick={() => setSettings(false)}>
          <div className="modal-card away" onClick={(event) => event.stopPropagation()}>
            <WindowHead title={t('settings')} onClose={() => setSettings(false)} closeLabel={t('close')} />
            <div className="modal-card-body">
            <div className="kv">
              <span>{t('loop')}</span>
              <button className={`btn ${loop ? 'gold' : ''}`} onClick={() => setLoop(!loop)}>{loop ? 'on' : 'off'}</button>
              <span>{t('settingsLang')}</span>
              <div className="row">
                <button className={`btn ${locale === 'pt' ? 'gold' : ''}`} onClick={() => setLocale('pt')}>BR</button>
                <button className={`btn ${locale === 'en' ? 'gold' : ''}`} onClick={() => setLocale('en')}>US</button>
              </div>
            </div>
            <p className="lede modal-lede-left">{t('settingsHint')}</p>
            <button className="btn" style={{ width: '100%', marginBottom: 12 }} onClick={() => {
              setSettings(false);
              setReplayTutorial(true);
            }}>{locale === 'pt' ? 'Rever tutorial de primeiros passos' : 'Replay the beginner tutorial'}</button>
            <button className="btn gold" style={{ width: '100%' }} onClick={() => setSettings(false)}>{t('gotIt')}</button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
