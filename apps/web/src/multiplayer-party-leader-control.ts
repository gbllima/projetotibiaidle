import { ApiError, api } from './api/client.js';

/**
 * Multiplayer party movement rule:
 * - the leader controls entering/leaving the shared hunt;
 * - when the leader leaves, api.stopHunt already uses the shared endpoint and
 *   brings every multiplayer member back to the city;
 * - a follower cannot leave the hunt independently while still attached to the
 *   multiplayer party. To regain individual control they must explicitly leave
 *   the multiplayer party first.
 *
 * Keep this as a small client guard as well as the server-side shared-hunt rule,
 * so the player gets an immediate, clear message instead of briefly splitting
 * from the leader on screen.
 */
const stopHunt = api.stopHunt;

api.stopHunt = async (characterId: number) => {
  const multiplayer = await api.multiplayerParty(characterId).catch(() => null);

  if (multiplayer?.active && !multiplayer.isLeader) {
    throw new ApiError(
      'Você está seguindo o líder da Party Multiplayer. Apenas o líder pode sair da hunt. Para sair sozinho, selecione “Sair da party multiplayer” primeiro.',
      403,
    );
  }

  return stopHunt(characterId);
};
