/** Who is actually connected to the live socket. */

const connected = new Map<number, number>();

export function markOnline(characterId: number, now = Date.now()): void {
  connected.set(characterId, now);
}

export function markOffline(characterId: number): void {
  connected.delete(characterId);
}

export function onlineCharacterIds(): number[] {
  return [...connected.keys()];
}
