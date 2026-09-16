import { ApiError, storedToken } from './client.js';
import type { CharacterView } from './types.js';

export async function moveDepotToBackpack(characterId: number, itemId: number, count: number): Promise<CharacterView> {
  const token = storedToken();
  const response = await fetch(`/api/characters/${characterId}/depot-to-backpack`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ itemId, count }),
  });

  const payload = await response.json().catch(() => ({})) as { character?: CharacterView; error?: string };
  if (!response.ok || !payload.character) {
    throw new ApiError(payload.error || 'Falha ao mover o item para a Backpack.', response.status);
  }
  return payload.character;
}
