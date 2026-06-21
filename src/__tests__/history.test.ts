import { describe, it, expect } from 'vitest';
import { createStore, createMergeableStore } from 'tinybase';
import { createHistory } from '../create';

let idCounter = 0;
function testId() {
  return String(++idCounter).padStart(8, '0');
}

function setup() {
  idCounter = 0;
  const store = createStore();
  const history = createHistory(store, { generateId: testId });
  return { store, history };
}

describe('action()', () => {
  it('captures delta into history row', () => {
    const { store, history } = setup();

    const id = history.action(() => {
      store.setCell('pets', 'fido', 'species', 'dog');
    });

    expect(id).toBe('00000001');

    const row = store.getRow('_history', '00000001');
    expect(row.undone).toBe(0);
    expect(row.createdAt).toBeTypeOf('number');

    const delta = JSON.parse(row.delta as string);
    expect(delta).toEqual({
      pets: { fido: { species: [null, 'dog'] } },
    });
  });

  it('returns undefined for no-op mutation', () => {
    const { store, history } = setup();

    const id = history.action(() => {
      // do nothing
    });

    expect(id).toBeUndefined();
    expect(store.getRowIds('_history')).toEqual([]);
  });

  it('returns undefined when mutation has no net change', () => {
    const { store, history } = setup();
    store.setCell('pets', 'fido', 'species', 'dog');

    const id = history.action(() => {
      store.setCell('pets', 'fido', 'species', 'cat');
      store.setCell('pets', 'fido', 'species', 'dog');
    });

    expect(id).toBeUndefined();
  });

  it('captures value changes', () => {
    const { store, history } = setup();

    const id = history.action(() => {
      store.setValue('theme', 'dark');
    });

    expect(id).toBeDefined();
    const row = store.getRow('_history', id!);
    const dv = JSON.parse(row.dv as string);
    expect(dv).toEqual({ theme: [null, 'dark'] });
  });

  it('filters _history table from captured delta', () => {
    const { store, history } = setup();

    const id = history.action(() => {
      store.setCell('pets', 'fido', 'species', 'dog');
    });

    expect(id).toBeDefined();
    const delta = JSON.parse(store.getCell('_history', id!, 'delta') as string);
    expect(delta._history).toBeUndefined();
    expect(delta.pets).toBeDefined();
  });
});

describe('goBackward() / goForward()', () => {
  it('goBackward restores data and marks undone', () => {
    const { store, history } = setup();

    history.action(() => {
      store.setCell('pets', 'fido', 'species', 'dog');
    });

    expect(store.getCell('pets', 'fido', 'species')).toBe('dog');

    history.goBackward();

    expect(store.getCell('pets', 'fido', 'species')).toBeUndefined();
    expect(store.getCell('_history', '00000001', 'undone')).toBe(1);
  });

  it('goForward re-applies data and clears undone', () => {
    const { store, history } = setup();

    history.action(() => {
      store.setCell('pets', 'fido', 'species', 'dog');
    });
    history.goBackward();
    history.goForward();

    expect(store.getCell('pets', 'fido', 'species')).toBe('dog');
    expect(store.getCell('_history', '00000001', 'undone')).toBe(0);
  });

  it('goBackward is no-op when no actions', () => {
    const { history } = setup();
    expect(() => history.goBackward()).not.toThrow();
  });

  it('goForward is no-op when nothing undone', () => {
    const { store, history } = setup();
    history.action(() => store.setCell('pets', 'fido', 'species', 'dog'));
    expect(() => history.goForward()).not.toThrow();
    expect(store.getCell('pets', 'fido', 'species')).toBe('dog');
  });

  it('handles multi-cell changes', () => {
    const { store, history } = setup();

    history.action(() => {
      store.setCell('pets', 'fido', 'species', 'dog');
      store.setCell('pets', 'fido', 'color', 'brown');
    });

    history.goBackward();

    expect(store.getCell('pets', 'fido', 'species')).toBeUndefined();
    expect(store.getCell('pets', 'fido', 'color')).toBeUndefined();
  });

  it('handles cell modification (not just add/delete)', () => {
    const { store, history } = setup();
    store.setCell('pets', 'fido', 'color', 'brown');

    history.action(() => {
      store.setCell('pets', 'fido', 'color', 'walnut');
    });

    expect(store.getCell('pets', 'fido', 'color')).toBe('walnut');

    history.goBackward();
    expect(store.getCell('pets', 'fido', 'color')).toBe('brown');

    history.goForward();
    expect(store.getCell('pets', 'fido', 'color')).toBe('walnut');
  });

  it('handles value undo/redo', () => {
    const { store, history } = setup();
    store.setValue('count', 1);

    history.action(() => {
      store.setValue('count', 2);
    });

    history.goBackward();
    expect(store.getValue('count')).toBe(1);

    history.goForward();
    expect(store.getValue('count')).toBe(2);
  });

  it('handles multi-step undo/redo cycle', () => {
    const { store, history } = setup();

    history.action(() => store.setCell('a', 'r', 'c', 1));
    history.action(() => store.setCell('a', 'r', 'c', 2));
    history.action(() => store.setCell('a', 'r', 'c', 3));

    history.goBackward();
    history.goBackward();
    expect(store.getCell('a', 'r', 'c')).toBe(1);

    history.goForward();
    expect(store.getCell('a', 'r', 'c')).toBe(2);

    // New action clears remaining redo
    history.action(() => store.setCell('a', 'r', 'c', 99));
    expect(store.getCell('a', 'r', 'c')).toBe(99);
    expect(history.canGoForward()).toBe(false);

    // Actions 1, 2 (re-done), and 99 remain; action 3 was cleared
    const [backward, current] = history.getActionIds();
    expect(backward.length).toBe(2);
    expect(current).toBeDefined();
  });

  it('handles values-only action undo/redo', () => {
    const { store, history } = setup();

    history.action(() => {
      store.setValue('theme', 'dark');
      store.setValue('lang', 'en');
    });

    history.goBackward();
    expect(store.getValue('theme')).toBeUndefined();
    expect(store.getValue('lang')).toBeUndefined();

    history.goForward();
    expect(store.getValue('theme')).toBe('dark');
    expect(store.getValue('lang')).toBe('en');
  });
});

describe('redo stack clearing', () => {
  it('new action clears redo stack', () => {
    const { store, history } = setup();

    history.action(() => store.setCell('pets', 'fido', 'species', 'dog'));
    history.action(() => store.setCell('pets', 'fido', 'color', 'brown'));

    history.goBackward();
    expect(history.canGoForward()).toBe(true);

    history.action(() => store.setCell('pets', 'fido', 'color', 'black'));
    expect(history.canGoForward()).toBe(false);

    const [backward, current, forward] = history.getActionIds();
    expect(forward).toEqual([]);
    expect(backward.length).toBe(1);
    expect(current).toBeDefined();
  });
});

describe('getActionIds()', () => {
  it('returns correct [backward, current, forward] shape', () => {
    const { store, history } = setup();

    const id1 = history.action(() => store.setCell('a', 'r1', 'c', 1));
    const id2 = history.action(() => store.setCell('a', 'r2', 'c', 2));
    const id3 = history.action(() => store.setCell('a', 'r3', 'c', 3));

    const [backward, current, forward] = history.getActionIds();
    expect(backward).toEqual([id1, id2]);
    expect(current).toBe(id3);
    expect(forward).toEqual([]);
  });

  it('moves items between lists on undo/redo', () => {
    const { store, history } = setup();

    const id1 = history.action(() => store.setCell('a', 'r1', 'c', 1));
    const id2 = history.action(() => store.setCell('a', 'r2', 'c', 2));

    history.goBackward();

    const [backward, current, forward] = history.getActionIds();
    expect(backward).toEqual([]);
    expect(current).toBe(id1);
    expect(forward).toEqual([id2]);
  });

  it('returns [[], undefined, []] when empty', () => {
    const { history } = setup();
    const [backward, current, forward] = history.getActionIds();
    expect(backward).toEqual([]);
    expect(current).toBeUndefined();
    expect(forward).toEqual([]);
  });
});

describe('canGoBackward() / canGoForward()', () => {
  it('returns false when empty', () => {
    const { history } = setup();
    expect(history.canGoBackward()).toBe(false);
    expect(history.canGoForward()).toBe(false);
  });

  it('canGoBackward after action', () => {
    const { store, history } = setup();
    history.action(() => store.setCell('a', 'r', 'c', 1));
    expect(history.canGoBackward()).toBe(true);
    expect(history.canGoForward()).toBe(false);
  });

  it('canGoForward after undo', () => {
    const { store, history } = setup();
    history.action(() => store.setCell('a', 'r', 'c', 1));
    history.goBackward();
    expect(history.canGoBackward()).toBe(false);
    expect(history.canGoForward()).toBe(true);
  });
});

describe('withBypass', () => {
  it('calls withBypass for history table writes', () => {
    const store = createStore();
    const bypassCalls: string[] = [];
    const history = createHistory(store, {
      generateId: testId,
      withBypass: (fn) => {
        bypassCalls.push('bypass');
        fn();
      },
    });

    history.action(() => store.setCell('pets', 'fido', 'species', 'dog'));
    expect(bypassCalls.length).toBeGreaterThan(0);
  });
});

describe('lifecycle', () => {
  it('getStore returns the store', () => {
    const { store, history } = setup();
    expect(history.getStore()).toBe(store);
  });

  it('destroy stops capturing actions', () => {
    const { store, history } = setup();
    history.destroy();

    const id = history.action(() =>
      store.setCell('pets', 'fido', 'species', 'dog')
    );
    expect(id).toBeUndefined();
  });
});

describe('CRDT sync', () => {
  it('history rows appear on peer after merge', () => {
    idCounter = 0;
    const store1 = createMergeableStore();
    const history = createHistory(store1, { generateId: testId });

    history.action(() => {
      store1.setCell('pets', 'fido', 'species', 'dog');
    });

    const store2 = createMergeableStore();
    store2.setMergeableContent(store1.getMergeableContent());

    expect(store2.getCell('pets', 'fido', 'species')).toBe('dog');
    expect(store2.getRowIds('_history').length).toBe(1);
    expect(store2.getCell('_history', '00000001', 'undone')).toBe(0);
  });

  it('peer can read and undo actions synced from another peer', () => {
    idCounter = 0;
    const store1 = createMergeableStore();
    const h1 = createHistory(store1, { generateId: testId });

    h1.action(() => store1.setCell('files', 'f1', 'name', 'photo.jpg'));

    const store2 = createMergeableStore();
    store2.setMergeableContent(store1.getMergeableContent());

    const h2 = createHistory(store2, { generateId: testId });

    expect(h2.canGoBackward()).toBe(true);
    h2.goBackward();
    expect(store2.getCell('files', 'f1', 'name')).toBeUndefined();
    expect(store2.getCell('_history', '00000001', 'undone')).toBe(1);
  });

  it('concurrent add + undo: both peers converge', () => {
    // Peer A and B start from same state
    const storeA = createMergeableStore();
    let id = 0;
    const hA = createHistory(storeA, {
      generateId: () => `a-${String(++id).padStart(4, '0')}`,
    });

    hA.action(() => storeA.setCell('files', 'f1', 'name', 'original.jpg'));

    // Peer B gets a copy
    const storeB = createMergeableStore();
    storeB.setMergeableContent(storeA.getMergeableContent());
    let idB = 0;
    const hB = createHistory(storeB, {
      generateId: () => `b-${String(++idB).padStart(4, '0')}`,
    });

    // Peer B undoes the original add (removes f1)
    hB.goBackward();
    expect(storeB.getCell('files', 'f1', 'name')).toBeUndefined();

    // Peer A concurrently adds a new file
    hA.action(() => storeA.setCell('files', 'f2', 'name', 'new.jpg'));

    // Sync B's changes to A
    storeA.applyMergeableChanges(storeB.getMergeableContent());
    // Sync A's changes to B
    storeB.applyMergeableChanges(storeA.getMergeableContent());

    // Both peers converge: f1 gone, f2 exists
    for (const store of [storeA, storeB]) {
      expect(store.getCell('files', 'f1', 'name')).toBeUndefined();
      expect(store.getCell('files', 'f2', 'name')).toBe('new.jpg');
    }

    // Both peers see: action a-0001 undone, action a-0002 active
    for (const store of [storeA, storeB]) {
      expect(store.getCell('_history', 'a-0001', 'undone')).toBe(1);
      expect(store.getCell('_history', 'a-0002', 'undone')).toBe(0);
    }

    // Peer B's redo is orphaned (action 2 is newer and active) → excluded
    expect(hB.canGoForward()).toBe(false);
  });

  it('concurrent edits to same cell: LWW determines winner', () => {
    const storeA = createMergeableStore();
    let idA = 0;
    const hA = createHistory(storeA, {
      generateId: () => `a-${String(++idA).padStart(4, '0')}`,
    });

    hA.action(() => storeA.setCell('doc', 'title', 'text', 'Draft'));

    const storeB = createMergeableStore();
    storeB.setMergeableContent(storeA.getMergeableContent());
    let idB = 0;
    const hB = createHistory(storeB, {
      generateId: () => `b-${String(++idB).padStart(4, '0')}`,
    });

    // Peer A changes title
    hA.action(() => storeA.setCell('doc', 'title', 'text', 'Final'));
    // Peer B also changes title (later HLC timestamp wins)
    hB.action(() => storeB.setCell('doc', 'title', 'text', 'Review'));

    // Sync both ways
    storeA.applyMergeableChanges(storeB.getMergeableContent());
    storeB.applyMergeableChanges(storeA.getMergeableContent());

    // Both stores converge to the same value (LWW)
    const finalA = storeA.getCell('doc', 'title', 'text');
    const finalB = storeB.getCell('doc', 'title', 'text');
    expect(finalA).toBe(finalB);

    // Both history tables have both actions
    expect(storeA.getRowIds('_history').length).toBeGreaterThanOrEqual(2);
    expect(storeB.getRowIds('_history').length).toBeGreaterThanOrEqual(2);
  });

  it('undo vs mutate on same cell: LWW picks a winner, history diverges', () => {
    const storeA = createMergeableStore();
    let idA = 0;
    const hA = createHistory(storeA, {
      generateId: () => `a-${String(++idA).padStart(4, '0')}`,
    });

    // Both peers start with f1.name = 'original'
    hA.action(() => storeA.setCell('files', 'f1', 'name', 'original'));

    const storeB = createMergeableStore();
    storeB.setMergeableContent(storeA.getMergeableContent());
    const hB = createHistory(storeB);

    // Peer A renames the file (same cell)
    hA.action(() => storeA.setCell('files', 'f1', 'name', 'renamed'));

    // Peer B undoes action 1 — tries to delete f1.name (restore to null)
    hB.goBackward();
    expect(storeB.getCell('files', 'f1', 'name')).toBeUndefined();

    // Sync both ways
    storeA.applyMergeableChanges(storeB.getMergeableContent());
    storeB.applyMergeableChanges(storeA.getMergeableContent());

    // LWW: both peers converge to the SAME value
    const finalA = storeA.getCell('files', 'f1', 'name');
    const finalB = storeB.getCell('files', 'f1', 'name');
    expect(finalA).toBe(finalB);

    // The winner depends on HLC timestamps — we can't predict which,
    // but the stores are consistent with each other.
    // The history metadata (undone flags) also synced.
    expect(storeA.getCell('_history', 'a-0001', 'undone')).toBe(
      storeB.getCell('_history', 'a-0001', 'undone')
    );
  });

  it('undo-add vs concurrent cell edit: torn row from cell-level CRDT', () => {
    const storeA = createMergeableStore();
    let idA = 0;
    const hA = createHistory(storeA, {
      generateId: () => `a-${String(++idA).padStart(4, '0')}`,
    });

    // Action 1: add file with multiple cells
    hA.action(() => {
      storeA.setRow('files', 'f1', {
        name: 'photo.jpg',
        size: 100,
        addedBy: 'alice',
      });
    });

    // Clone to B
    const storeB = createMergeableStore();
    storeB.setMergeableContent(storeA.getMergeableContent());
    const hB = createHistory(storeB);

    // B undoes → deletes all cells of f1
    hB.goBackward();
    expect(storeB.getRow('files', 'f1')).toEqual({});

    // A concurrently edits one cell of the same file
    hA.action(() => {
      storeA.setCell('files', 'f1', 'name', 'renamed.jpg');
    });

    // Sync
    storeA.applyMergeableChanges(storeB.getMergeableContent());
    storeB.applyMergeableChanges(storeA.getMergeableContent());

    // Cell-level CRDT: each cell resolves independently
    // 'name': B deleted, A set 'renamed.jpg' → winner depends on HLC
    // 'size': B deleted, A didn't touch → deleted
    // 'addedBy': B deleted, A didn't touch → deleted
    const rowA = storeA.getRow('files', 'f1');
    const rowB = storeB.getRow('files', 'f1');

    // Peers converge
    expect(rowA).toEqual(rowB);

    // The row is "torn" — at most 'name' survives, 'size' and 'addedBy' are gone
    expect(rowA.size).toBeUndefined();
    expect(rowA.addedBy).toBeUndefined();
  });

  it('undo-change vs concurrent edit on same cell: LWW picks one', () => {
    const storeA = createMergeableStore();
    let idA = 0;
    const hA = createHistory(storeA, {
      generateId: () => `a-${String(++idA).padStart(4, '0')}`,
    });

    storeA.setCell('doc', 'r', 'title', 'Untitled');
    hA.action(() => storeA.setCell('doc', 'r', 'title', 'Draft'));

    const storeB = createMergeableStore();
    storeB.setMergeableContent(storeA.getMergeableContent());
    const hB = createHistory(storeB);

    // B undoes → sets title back to 'Untitled' (setCell, not delCell)
    hB.goBackward();
    expect(storeB.getCell('doc', 'r', 'title')).toBe('Untitled');

    // A concurrently edits to 'Final'
    hA.action(() => storeA.setCell('doc', 'r', 'title', 'Final'));

    // Sync
    storeA.applyMergeableChanges(storeB.getMergeableContent());
    storeB.applyMergeableChanges(storeA.getMergeableContent());

    // Both converge to the same value — LWW
    const titleA = storeA.getCell('doc', 'r', 'title');
    const titleB = storeB.getCell('doc', 'r', 'title');
    expect(titleA).toBe(titleB);
    expect(titleA).toBeTypeOf('string');
  });

  it('orphaned redo excluded from forward after concurrent action', () => {
    const storeA = createMergeableStore();
    let idA = 0;
    const hA = createHistory(storeA, {
      generateId: () => `a-${String(++idA).padStart(4, '0')}`,
    });

    // Action 1: add file
    hA.action(() => storeA.setCell('files', 'f1', 'name', 'photo.jpg'));

    const storeB = createMergeableStore();
    storeB.setMergeableContent(storeA.getMergeableContent());
    const hB = createHistory(storeB);

    // B undoes action 1 → redo available (before sync)
    hB.goBackward();
    expect(hB.canGoForward()).toBe(true);

    // A creates action 2 (doesn't see B's undo → doesn't clear it)
    hA.action(() => storeA.setCell('files', 'f2', 'name', 'other.jpg'));

    // Sync
    storeA.applyMergeableChanges(storeB.getMergeableContent());
    storeB.applyMergeableChanges(storeA.getMergeableContent());

    // Action 1 (undone=1) is now BEFORE action 2 (undone=0)
    // → orphaned redo, excluded from forward list
    expect(hB.canGoForward()).toBe(false);

    const [_backward, current, forward] = hB.getActionIds();
    expect(forward).toEqual([]);
    expect(current).toBeDefined();

    // The undone row still exists in the table (cleaned up by next
    // action() call or by cleanup())
    expect(storeB.getCell('_history', 'a-0001', 'undone')).toBe(1);
  });

  it('undo of same action on two peers is idempotent', () => {
    const storeA = createMergeableStore();
    let idA = 0;
    const hA = createHistory(storeA, {
      generateId: () => `a-${String(++idA).padStart(4, '0')}`,
    });

    hA.action(() => storeA.setCell('files', 'f1', 'name', 'photo.jpg'));

    const storeB = createMergeableStore();
    storeB.setMergeableContent(storeA.getMergeableContent());
    const hB = createHistory(storeB);

    // Both peers undo the same action
    hA.goBackward();
    hB.goBackward();

    // Sync
    storeA.applyMergeableChanges(storeB.getMergeableContent());
    storeB.applyMergeableChanges(storeA.getMergeableContent());

    // Both set undone=1 on the same row — idempotent via CRDT
    expect(storeA.getCell('_history', 'a-0001', 'undone')).toBe(1);
    expect(storeB.getCell('_history', 'a-0001', 'undone')).toBe(1);

    // Data converges: f1 is gone on both
    expect(storeA.getCell('files', 'f1', 'name')).toBeUndefined();
    expect(storeB.getCell('files', 'f1', 'name')).toBeUndefined();
  });
});

// ─── Collision & conflict scenarios ────────────────────────────────────

describe('undo after external store mutation (stale delta)', () => {
  it('undo overwrites concurrent change with old value', () => {
    const { store, history } = setup();
    store.setCell('pets', 'fido', 'color', 'brown');

    history.action(() => store.setCell('pets', 'fido', 'color', 'walnut'));

    // External mutation (not tracked by history)
    store.setCell('pets', 'fido', 'color', 'black');

    // Undo applies the OLD value from the delta — overwrites 'black'
    history.goBackward();
    expect(store.getCell('pets', 'fido', 'color')).toBe('brown');
  });

  it('undo of row addition when row was externally modified', () => {
    const { store, history } = setup();

    history.action(() => {
      store.setCell('files', 'f1', 'name', 'a.jpg');
      store.setCell('files', 'f1', 'size', 100);
    });

    // External mutation adds a new cell to the same row
    store.setCell('files', 'f1', 'extra', 'metadata');

    // Undo deletes the cells that were added by the action
    // but the externally-added cell remains (it's not in the delta)
    history.goBackward();
    expect(store.getCell('files', 'f1', 'name')).toBeUndefined();
    expect(store.getCell('files', 'f1', 'size')).toBeUndefined();
    expect(store.getCell('files', 'f1', 'extra')).toBe('metadata');
  });
});

describe('row deletion undo', () => {
  it('undo of row deletion restores all cells', () => {
    const { store, history } = setup();
    store.setRow('files', 'f1', {
      name: 'photo.jpg',
      size: 2048,
      type: 'image/jpeg',
    });

    history.action(() => store.delRow('files', 'f1'));
    expect(store.getRow('files', 'f1')).toEqual({});

    history.goBackward();
    expect(store.getCell('files', 'f1', 'name')).toBe('photo.jpg');
    expect(store.getCell('files', 'f1', 'size')).toBe(2048);
    expect(store.getCell('files', 'f1', 'type')).toBe('image/jpeg');
  });

  it('redo after undo of row deletion removes it again', () => {
    const { store, history } = setup();
    store.setRow('files', 'f1', { name: 'photo.jpg', size: 2048 });

    history.action(() => store.delRow('files', 'f1'));
    history.goBackward();
    history.goForward();

    expect(store.getRow('files', 'f1')).toEqual({});
  });
});

describe('multi-table action', () => {
  it('action spanning multiple tables captures and undoes all', () => {
    const { store, history } = setup();

    history.action(() => {
      store.setCell('files', 'f1', 'name', 'photo.jpg');
      store.setCell('members', 'alice', 'role', 'owner');
      store.setValue('albumName', 'Vacation');
    });

    history.goBackward();

    expect(store.getCell('files', 'f1', 'name')).toBeUndefined();
    expect(store.getCell('members', 'alice', 'role')).toBeUndefined();
    expect(store.getValue('albumName')).toBeUndefined();

    history.goForward();

    expect(store.getCell('files', 'f1', 'name')).toBe('photo.jpg');
    expect(store.getCell('members', 'alice', 'role')).toBe('owner');
    expect(store.getValue('albumName')).toBe('Vacation');
  });
});

describe('action() error handling', () => {
  it('action that throws after mutations records and is undoable', () => {
    const { store, history } = setup();

    expect(() => {
      history.action(() => {
        store.setCell('pets', 'fido', 'species', 'dog');
        throw new Error('something broke');
      });
    }).toThrow('something broke');

    // TinyBase commits partial mutations — history captures them
    expect(store.getCell('pets', 'fido', 'species')).toBe('dog');
    expect(store.getRowIds('_history').length).toBe(1);

    // The partial mutation is undoable
    history.goBackward();
    expect(store.getCell('pets', 'fido', 'species')).toBeUndefined();
  });

  it('action that throws before any mutation creates no entry', () => {
    const { store, history } = setup();

    expect(() => {
      history.action(() => {
        throw new Error('fail early');
      });
    }).toThrow('fail early');

    expect(store.getRowIds('_history')).toEqual([]);
  });

  it('store recovers after throw — next action works', () => {
    const { store, history } = setup();

    try {
      history.action(() => {
        throw new Error('fail');
      });
    } catch {
      // swallow
    }

    const id = history.action(() =>
      store.setCell('pets', 'fido', 'species', 'dog')
    );
    expect(id).toBeDefined();
    expect(store.getCell('pets', 'fido', 'species')).toBe('dog');
  });
});

describe('goBackward when delta references non-existent cells', () => {
  it('delCell on missing cell is a no-op (does not throw)', () => {
    const { store, history } = setup();

    history.action(() => {
      store.setCell('files', 'f1', 'name', 'a.jpg');
    });

    // Externally delete the row before undo
    store.delRow('files', 'f1');

    // Undo tries to delCell('files', 'f1', 'name') — cell already gone
    expect(() => history.goBackward()).not.toThrow();
  });
});

describe('nested transactions', () => {
  it('action with nested store.transaction() captures all changes', () => {
    const { store, history } = setup();

    const id = history.action(() => {
      store.transaction(() => {
        store.setCell('a', 'r1', 'c', 1);
      });
      store.transaction(() => {
        store.setCell('a', 'r2', 'c', 2);
      });
    });

    expect(id).toBeDefined();

    const delta = JSON.parse(store.getCell('_history', id!, 'delta') as string);
    expect(delta.a.r1).toBeDefined();
    expect(delta.a.r2).toBeDefined();

    history.goBackward();
    expect(store.getCell('a', 'r1', 'c')).toBeUndefined();
    expect(store.getCell('a', 'r2', 'c')).toBeUndefined();
  });
});

describe('custom tableName', () => {
  it('uses custom table name for history storage', () => {
    idCounter = 0;
    const store = createStore();
    const history = createHistory(store, {
      generateId: testId,
      tableName: '_audit',
    });

    history.action(() => store.setCell('a', 'r', 'c', 1));

    expect(store.getRowIds('_audit').length).toBe(1);
    expect(store.getRowIds('_history')).toEqual([]);

    history.goBackward();
    expect(store.getCell('a', 'r', 'c')).toBeUndefined();
  });

  it('custom table is filtered from its own deltas', () => {
    idCounter = 0;
    const store = createStore();
    const history = createHistory(store, {
      generateId: testId,
      tableName: '_audit',
    });

    history.action(() => store.setCell('data', 'r', 'c', 1));

    const delta = JSON.parse(
      store.getCell('_audit', '00000001', 'delta') as string
    );
    expect(delta._audit).toBeUndefined();
    expect(delta.data).toBeDefined();
  });
});

describe('default generateId', () => {
  it('generates unique IDs without custom generator', () => {
    const store = createStore();
    const history = createHistory(store);

    const id1 = history.action(() => store.setCell('a', 'r1', 'c', 1));
    const id2 = history.action(() => store.setCell('a', 'r2', 'c', 2));

    expect(id1).toBeDefined();
    expect(id2).toBeDefined();
    expect(id1).not.toBe(id2);
  });
});

describe('rapid sequential actions', () => {
  it('20 actions produce correct history and full undo', () => {
    const { store, history } = setup();

    for (let i = 0; i < 20; i++) {
      history.action(() => store.setCell('counter', 'r', 'val', i));
    }

    const [backward, current] = history.getActionIds();
    expect(backward.length + (current ? 1 : 0)).toBe(20);

    // Undo all 20
    for (let i = 0; i < 20; i++) {
      history.goBackward();
    }

    expect(store.getCell('counter', 'r', 'val')).toBeUndefined();
    expect(history.canGoBackward()).toBe(false);
    expect(history.canGoForward()).toBe(true);

    // Redo all 20
    for (let i = 0; i < 20; i++) {
      history.goForward();
    }

    expect(store.getCell('counter', 'r', 'val')).toBe(19);
    expect(history.canGoForward()).toBe(false);
  });
});
