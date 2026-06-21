import { describe, it, expect } from 'vitest';
import { createStore } from 'tinybase';
import {
  deserializeDelta,
  deserializeDeltaValues,
  applyReverse,
  applyForward,
} from '../delta';

describe('serialization roundtrip', () => {
  it('roundtrips cell delta through JSON (undefined → null)', () => {
    const changedCells = {
      files: {
        row1: { name: [undefined, 'photo.jpg'], size: [undefined, 1024] },
        row2: { deleted: ['old', 'new'] },
      },
    };
    const json = JSON.stringify(changedCells);
    const parsed = deserializeDelta(json);
    expect(parsed).toEqual({
      files: {
        row1: { name: [null, 'photo.jpg'], size: [null, 1024] },
        row2: { deleted: ['old', 'new'] },
      },
    });
  });

  it('roundtrips value delta through JSON', () => {
    const changedValues = {
      theme: ['light', 'dark'],
      count: [undefined, 5],
    };
    const json = JSON.stringify(changedValues);
    const parsed = deserializeDeltaValues(json);
    expect(parsed).toEqual({
      theme: ['light', 'dark'],
      count: [null, 5],
    });
  });
});

describe('applyReverse', () => {
  it('restores old cell values', () => {
    const store = createStore();
    store.setCell('pets', 'fido', 'color', 'walnut');

    const delta = {
      pets: { fido: { color: ['brown', 'walnut'] as [string, string] } },
    };
    applyReverse(store, delta, {});

    expect(store.getCell('pets', 'fido', 'color')).toBe('brown');
  });

  it('deletes cells that were added (old = null)', () => {
    const store = createStore();
    store.setCell('pets', 'fido', 'species', 'dog');

    const delta = {
      pets: { fido: { species: [null, 'dog'] as [null, string] } },
    };
    applyReverse(store, delta, {});

    expect(store.getCell('pets', 'fido', 'species')).toBeUndefined();
  });

  it('restores deleted cells (new = null)', () => {
    const store = createStore();

    const delta = {
      pets: { fido: { species: ['dog', null] as [string, null] } },
    };
    applyReverse(store, delta, {});

    expect(store.getCell('pets', 'fido', 'species')).toBe('dog');
  });

  it('restores old values', () => {
    const store = createStore();
    store.setValue('theme', 'dark');

    applyReverse(store, {}, { theme: ['light', 'dark'] });

    expect(store.getValue('theme')).toBe('light');
  });
});

describe('applyForward', () => {
  it('applies new cell values', () => {
    const store = createStore();
    store.setCell('pets', 'fido', 'color', 'brown');

    const delta = {
      pets: { fido: { color: ['brown', 'walnut'] as [string, string] } },
    };
    applyForward(store, delta, {});

    expect(store.getCell('pets', 'fido', 'color')).toBe('walnut');
  });

  it('adds cells that were added (old = null)', () => {
    const store = createStore();

    const delta = {
      pets: { fido: { species: [null, 'dog'] as [null, string] } },
    };
    applyForward(store, delta, {});

    expect(store.getCell('pets', 'fido', 'species')).toBe('dog');
  });

  it('deletes cells (new = null)', () => {
    const store = createStore();
    store.setCell('pets', 'fido', 'species', 'dog');

    const delta = {
      pets: { fido: { species: ['dog', null] as [string, null] } },
    };
    applyForward(store, delta, {});

    expect(store.getCell('pets', 'fido', 'species')).toBeUndefined();
  });

  it('applies new values', () => {
    const store = createStore();
    store.setValue('theme', 'light');

    applyForward(store, {}, { theme: ['light', 'dark'] });

    expect(store.getValue('theme')).toBe('dark');
  });
});
