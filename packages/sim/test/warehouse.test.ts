import { describe, expect, it } from 'vitest';
import { addWarehouseStack, createCharacter, DEPOT_SLOT_CAP, warehouseHasRoom } from '../src/index.js';

describe('warehouse slots', () => {
  it('allows existing stacks to grow when full', () => {
    const warehouse = Array.from({ length: DEPOT_SLOT_CAP }, (_, index) => ({ itemId: 1000 + index, count: 1 }));
    expect(warehouseHasRoom(warehouse, 1000)).toBe(true);
    expect(addWarehouseStack(warehouse, 1000, 5)).toBe(5);
    expect(warehouse[0]?.count).toBe(6);
  });

  it('blocks new stacks when the depot is full', () => {
    const warehouse = Array.from({ length: DEPOT_SLOT_CAP }, (_, index) => ({ itemId: 1000 + index, count: 1 }));
    expect(warehouseHasRoom(warehouse, 9999)).toBe(false);
    expect(addWarehouseStack(warehouse, 9999, 1)).toBe(0);
    expect(warehouse.length).toBe(DEPOT_SLOT_CAP);
  });

  it('accepts a new stack when there is room', () => {
    const character = createCharacter('Storer', 1);
    character.warehouse = [{ itemId: 266, count: 10 }];
    expect(warehouseHasRoom(character.warehouse, 268)).toBe(true);
    expect(addWarehouseStack(character.warehouse, 268, 3)).toBe(3);
    expect(character.warehouse).toHaveLength(2);
  });
});
