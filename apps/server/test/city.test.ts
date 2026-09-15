import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CITY_WIDTH, CITY_HEIGHT, CITY_MERCHANT, CITY_SPAWN, CITY_STEP_MS, cityPath, cityTiles, cityWalkable } from '@tibia-idle/data';
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
  it('routes around the original Thais Depot walls and furniture', () => {
    expect([CITY_WIDTH, CITY_HEIGHT]).toEqual([19, 21]);
    expect(cityWalkable(CITY_SPAWN.x, CITY_SPAWN.y)).toBe(true);
    expect(cityWalkable(CITY_MERCHANT.x, CITY_MERCHANT.y)).toBe(false);
    expect(CITY_SPAWN).toEqual({ x: 9, y: 10 });
    expect(cityPath(CITY_SPAWN, { x: 10, y: 6 })).toEqual([]); // Enclosed booth remains blocked off.
    for (const destination of [{ x: 4, y: 8 }, { x: 8, y: 16 }, { x: 8, y: 4 }, { x: 14, y: 9 }, { x: 6, y: 8 }]) {
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
    expect((await move(4, 5)).json().accepted).toBe(false); // Nonadjacent destination.
    expect((await move(8, 12)).json().accepted).toBe(false);
    expect((await move(10, 10)).json().accepted).toBe(true);
    expect((await move(11, 10)).json().accepted).toBe(false);
    vi.mocked(Date.now).mockReturnValue(now + CITY_STEP_MS);
    expect((await move(11, 10)).json().accepted).toBe(true);
    vi.mocked(Date.now).mockReturnValue(now + 2 * CITY_STEP_MS);
    expect((await move(12, 10)).json().accepted).toBe(false); // Adjacent original wall.
    const lobby = await context.app.inject({ url: `/api/lobby?characterId=${second.id}`, headers: second.headers });
    expect(lobby.json().players.find((player: { id: number }) => player.id === first.id).cityPosition).toEqual({ x: 11, y: 10 });
    const forbidden = await context.app.inject({ method: 'POST', url: '/api/lobby/move', headers: second.headers, payload: { characterId: first.id, x: 23, y: 10 } });
    expect(forbidden.statusCode).toBe(404);
    const malformed = await move(24.5, 10);
    expect(malformed.statusCode).toBe(400);
    vi.mocked(Date.now).mockReturnValue(now + 16_000);
    const expired = await context.app.inject({ url: '/api/lobby', headers: second.headers });
    expect(expired.json().players).toEqual([]);
  });
});
