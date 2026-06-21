import { describe, it, expect, vi } from 'vitest';
import { createStore } from 'tinybase';
import { createHistory } from '../create';
import type { CleanedAction } from '../types';

let idCounter = 0;
function testId() {
  return String(++idCounter).padStart(8, '0');
}

function setup(opts?: { maxActions?: number; maxAge?: number }) {
  idCounter = 0;
  const store = createStore();
  const history = createHistory(store, {
    generateId: testId,
    ...opts,
  });
  return { store, history };
}

describe('cleanup by age', () => {
  it('removes actions older than maxAge', () => {
    const { store, history } = setup({ maxAge: 1000 });

    history.action(() => store.setCell('a', 'r1', 'c', 1));
    history.action(() => store.setCell('a', 'r2', 'c', 2));

    // Manually backdate the first action
    store.setCell('_history', '00000001', 'createdAt', Date.now() - 2000);

    history.cleanup();

    const rowIds = store.getRowIds('_history');
    expect(rowIds).toEqual(['00000002']);
  });
});

describe('cleanup by count', () => {
  it('removes oldest actions when exceeding maxActions', () => {
    const { store, history } = setup({ maxActions: 2 });

    history.action(() => store.setCell('a', 'r1', 'c', 1));
    history.action(() => store.setCell('a', 'r2', 'c', 2));
    history.action(() => store.setCell('a', 'r3', 'c', 3));

    expect(store.getRowIds('_history').length).toBe(3);

    history.cleanup();

    const rowIds = store.getRowIds('_history');
    expect(rowIds.length).toBe(2);
    expect(rowIds).not.toContain('00000001');
  });
});

describe('cleanup listener', () => {
  it('fires with correct cleaned action data', () => {
    const { store, history } = setup({ maxActions: 1 });

    history.action(() => store.setCell('a', 'r1', 'c', 1));
    history.action(() => store.setCell('a', 'r2', 'c', 2));

    const cleaned: CleanedAction[] = [];
    history.addCleanupListener((_h, actions) => {
      cleaned.push(...actions);
    });

    history.cleanup();

    expect(cleaned.length).toBe(1);
    expect(cleaned[0].id).toBe('00000001');
    expect(cleaned[0].undone).toBe(false);
    expect(cleaned[0].createdAt).toBeTypeOf('number');
    expect(JSON.parse(cleaned[0].delta)).toEqual({
      a: { r1: { c: [null, 1] } },
    });
  });

  it('fires before rows are deleted', () => {
    const { store, history } = setup({ maxActions: 1 });

    history.action(() => store.setCell('a', 'r1', 'c', 1));
    history.action(() => store.setCell('a', 'r2', 'c', 2));

    let rowCountDuringCallback = 0;
    history.addCleanupListener(() => {
      rowCountDuringCallback = store.getRowIds('_history').length;
    });

    history.cleanup();

    expect(rowCountDuringCallback).toBe(2);
    expect(store.getRowIds('_history').length).toBe(1);
  });

  it('indicates undone actions correctly', () => {
    const { store, history } = setup({ maxActions: 0 });

    history.action(() => store.setCell('a', 'r1', 'c', 1));
    history.goBackward();

    const cleaned: CleanedAction[] = [];
    history.addCleanupListener((_h, actions) => {
      cleaned.push(...actions);
    });

    history.cleanup();

    expect(cleaned[0].undone).toBe(true);
  });

  it('distinguishes undone vs non-undone in the same batch', () => {
    const { store, history } = setup({ maxActions: 0 });

    // Action 1: add row r1 — will stay (not undone)
    history.action(() => store.setCell('files', 'r1', 'name', 'keep.jpg'));
    // Action 2: add row r2 — will be undone
    history.action(() => store.setCell('files', 'r2', 'name', 'revert.jpg'));

    history.goBackward(); // undo action 2

    // Action 3: new action (clears redo — action 2 deleted from history)
    // So we need a different approach: undo action 2, then DON'T add a new
    // action, so the undone row survives to cleanup.

    // At this point: action 1 (undone=0), action 2 (undone=1)
    const cleaned: CleanedAction[] = [];
    history.addCleanupListener((_h, actions) => cleaned.push(...actions));

    history.cleanup();

    expect(cleaned.length).toBe(2);

    const kept = cleaned.find((a) => !a.undone)!;
    const reverted = cleaned.find((a) => a.undone)!;

    // Consumer can inspect delta to decide side effects
    const keptDelta = JSON.parse(kept.delta);
    expect(keptDelta.files.r1.name[1]).toBe('keep.jpg');
    // This action stuck → consumer should fire hard delete / finalize

    const revertedDelta = JSON.parse(reverted.delta);
    expect(revertedDelta.files.r2.name[1]).toBe('revert.jpg');
    // This action was reversed → consumer should skip side effects
  });

  it('can be removed with delListener', () => {
    const { store, history } = setup({ maxActions: 1 });

    history.action(() => store.setCell('a', 'r1', 'c', 1));
    history.action(() => store.setCell('a', 'r2', 'c', 2));

    const spy = vi.fn();
    const listenerId = history.addCleanupListener(spy);
    history.delListener(listenerId);

    history.cleanup();

    expect(spy).not.toHaveBeenCalled();
  });
});

describe('cleanup does nothing when not needed', () => {
  it('no-op when within limits', () => {
    const { store, history } = setup({ maxActions: 10, maxAge: 999999 });

    history.action(() => store.setCell('a', 'r1', 'c', 1));

    const spy = vi.fn();
    history.addCleanupListener(spy);

    history.cleanup();

    expect(spy).not.toHaveBeenCalled();
    expect(store.getRowIds('_history').length).toBe(1);
  });
});

describe('setMaxActions / setMaxAge', () => {
  it('setMaxActions changes the cleanup threshold', () => {
    const { store, history } = setup({ maxActions: 100 });

    history.action(() => store.setCell('a', 'r1', 'c', 1));
    history.action(() => store.setCell('a', 'r2', 'c', 2));
    history.action(() => store.setCell('a', 'r3', 'c', 3));

    history.setMaxActions(2);
    history.cleanup();

    expect(store.getRowIds('_history').length).toBe(2);
  });

  it('setMaxAge changes the age threshold', () => {
    const { store, history } = setup({ maxAge: 999999 });

    history.action(() => store.setCell('a', 'r1', 'c', 1));
    store.setCell('_history', '00000001', 'createdAt', Date.now() - 500);

    history.setMaxAge(100);
    history.cleanup();

    expect(store.getRowIds('_history').length).toBe(0);
  });
});

describe('orphaned redo cleanup', () => {
  it('orphaned redo is cleaned up by next action()', () => {
    const { store, history } = setup();

    history.action(() => store.setCell('files', 'f1', 'name', 'a.jpg'));
    history.goBackward();

    // Action 1 is undone — orphan it by creating a new action
    history.action(() => store.setCell('files', 'f2', 'name', 'b.jpg'));

    // The undo clearing in action() deleted the undone row
    expect(store.getCell('_history', '00000001', 'undone')).toBeUndefined();
    expect(store.getRowIds('_history').length).toBe(1);
  });

  it('orphaned redo is cleaned up by cleanup() and fires listener', () => {
    const { store, history } = setup({ maxActions: 1 });

    history.action(() => store.setCell('files', 'f1', 'name', 'a.jpg'));
    history.goBackward();

    // Simulate concurrent action from peer: inject a newer active row
    store.setRow('_history', 'peer-action', {
      createdAt: Date.now() + 1000,
      delta: JSON.stringify({ files: { f2: { name: [null, 'b.jpg'] } } }),
      dv: '{}',
      undone: 0,
    });

    // Now: action 00000001 (undone=1, t=early), peer-action (undone=0, t=late)
    // 00000001 is an orphaned redo — excluded from goForward
    expect(history.canGoForward()).toBe(false);

    const cleaned: CleanedAction[] = [];
    history.addCleanupListener((_h, actions) => cleaned.push(...actions));

    history.cleanup();

    // Orphaned redo was cleaned up (maxActions=1, two rows → one removed)
    expect(cleaned.length).toBe(1);
    expect(cleaned[0].id).toBe('00000001');
    expect(cleaned[0].undone).toBe(true);
  });

  it('orphaned redo of file add triggers ownership cleanup when file is gone', () => {
    const { store, history } = setup({ maxActions: 0 });

    // Action 1: add file
    history.action(() => {
      store.setCell('files', 'f1', 'name', 'photo.jpg');
      store.setCell('files', 'f1', 'addedBy', 'alice');
    });

    // Undo the add → file is gone
    history.goBackward();
    expect(store.getRow('files', 'f1')).toEqual({});

    // Simulate concurrent peer action (makes action 1 an orphaned redo)
    store.setRow('_history', 'peer-action', {
      createdAt: Date.now() + 1000,
      delta: JSON.stringify({ files: { f2: { name: [null, 'other.jpg'] } } }),
      dv: '{}',
      undone: 0,
    });

    // Cleanup — consumer checks current store state
    const removedFileIds: string[] = [];
    history.addCleanupListener((h, actions) => {
      const s = h.getStore();
      for (const action of actions) {
        const delta = JSON.parse(action.delta);
        if (delta.files) {
          for (const fileId of Object.keys(delta.files)) {
            if (Object.keys(s.getRow('files', fileId)).length === 0) {
              removedFileIds.push(fileId);
            }
          }
        }
      }
    });

    history.cleanup();

    // f1 is not in the store → consumer would deregister ownership
    expect(removedFileIds).toContain('f1');
  });

  it('orphaned redo of file removal does NOT trigger cleanup when file exists', () => {
    const { store, history } = setup({ maxActions: 0 });

    // Pre-populate file
    store.setRow('files', 'f1', { name: 'photo.jpg', addedBy: 'alice' });

    // Action 1: remove file
    history.action(() => store.delRow('files', 'f1'));

    // Undo the removal → file is back
    history.goBackward();
    expect(store.getRow('files', 'f1')).toMatchObject({ name: 'photo.jpg' });

    // Simulate concurrent peer action (orphans action 1)
    store.setRow('_history', 'peer-action', {
      createdAt: Date.now() + 1000,
      delta: JSON.stringify({ files: { f2: { name: [null, 'other.jpg'] } } }),
      dv: '{}',
      undone: 0,
    });

    const removedFileIds: string[] = [];
    history.addCleanupListener((h, actions) => {
      const s = h.getStore();
      for (const action of actions) {
        const delta = JSON.parse(action.delta);
        if (delta.files) {
          for (const fileId of Object.keys(delta.files)) {
            if (Object.keys(s.getRow('files', fileId)).length === 0) {
              removedFileIds.push(fileId);
            }
          }
        }
      }
    });

    history.cleanup();

    // f1 IS in the store → consumer should NOT deregister
    expect(removedFileIds).not.toContain('f1');
  });
});

describe('cleanup when all actions expired', () => {
  it('removes all rows and fires listener', () => {
    const { store, history } = setup({ maxActions: 0 });

    history.action(() => store.setCell('a', 'r1', 'c', 1));
    history.action(() => store.setCell('a', 'r2', 'c', 2));

    const cleaned: CleanedAction[] = [];
    history.addCleanupListener((_h, actions) => cleaned.push(...actions));

    history.cleanup();

    expect(store.getRowIds('_history').length).toBe(0);
    expect(cleaned.length).toBe(2);
  });
});
