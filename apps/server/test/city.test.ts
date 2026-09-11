import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CITY_SPAWN, CITY_STEP_MS, cityPath, cityTiles, cityWalkable } from '@tibia-idle/data';
import { createApp } from '../src/app.js';

let context: Awaited<ReturnType<typeof createApp>>;
beforeEach(async () => { context = await createApp({ databaseFile: ':memory:' }); });
afterEach(async () => { vi.restoreAllMocks(); await context.app.close(); });

async function visitor(username: string) {
  const registered = await context.app.inject({ method: 'POST', url: '/api/register', payload: { username, password: 'hunter2hunter2' } });
  const headers = { authorization: `Bearer ${registered.json().token}` };
  const created = await context.app.inject({ method: 'POST', url: '/api/characters', headers, payload: { name: username, vocationId: 4 } });
  expect(created.statusCode, created.body).toBe(201);
  return { headers, id: created.json().character.id as number };
}

describe('explorable city', () => {
  it('routes from the depot to the plaza around walls and pools', () => {
    for (const destination of [{ x: 8, y: 12 }, { x: 8, y: 24 }, { x: 8, y: 3 }, { x: 17, y: 9 }]) {
      const path = cityPath(CITY_SPAWN, destination);
      expect(path.at(-1)).toEqual(destination);
      let previous = CITY_SPAWN;
      for (const tile of path) {
        expect(cityWalkable(tile.x, tile.y)).toBe(true);
        expect(Math.abs(tile.x - previous.x) + Math.abs(tile.y - previous.y)).toBe(1);
        previous = tile;
      }
    }
    for (const tile of cityTiles.filter((tile) => tile.blocked)) expect(cityPath(CITY_SPAWN, tile)).toEqual([]);
  });

  it('shares movement with another player, rejects teleportation and limits speed', async () => {
    const first = await visitor('Citywalker'); const second = await visitor('Citywatcher');
    const now = Date.now(); vi.spyOn(Date, 'now').mockReturnValue(now);
    const enter = await context.app.inject({ url: `/api/lobby?characterId=${first.id}`, headers: first.headers });
    expect(enter.json().position).toEqual(CITY_SPAWN);
    const move = (x: number, y: number) => context.app.inject({ method: 'POST', url: '/api/lobby/move', headers: first.headers, payload: { characterId: first.id, x, y } });
    expect((await move(8, 12)).json().accepted).toBe(false);
    expect((await move(21, 10)).json().accepted).toBe(true);
    expect((await move(22, 10)).json().accepted).toBe(false);
    vi.mocked(Date.now).mockReturnValue(now + CITY_STEP_MS);
    expect((await move(22, 10)).json().accepted).toBe(true);
    const lobby = await context.app.inject({ url: `/api/lobby?characterId=${second.id}`, headers: second.headers });
    expect(lobby.json().players.find((player: { id: number }) => player.id === first.id).cityPosition).toEqual({ x: 22, y: 10 });
    const forbidden = await context.app.inject({ method: 'POST', url: '/api/lobby/move', headers: second.headers, payload: { characterId: first.id, x: 23, y: 10 } });
    expect(forbidden.statusCode).toBe(404);
    const malformed = await move(24.5, 10);
    expect(malformed.statusCode).toBe(400);
    vi.mocked(Date.now).mockReturnValue(now + 16_000);
    const expired = await context.app.inject({ url: '/api/lobby', headers: second.headers });
    expect(expired.json().players).toEqual([]);
  });
});
