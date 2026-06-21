import type { Store, Id } from 'tinybase';
import type { History as IHistory, CleanupListener } from './types';
import {
  deserializeDelta,
  deserializeDeltaValues,
  applyReverse,
  applyForward,
} from './delta';
import { runCleanup } from './cleanup';

export class History implements IHistory {
  private pendingAction: string | undefined;
  private pendingActionRecorded = false;
  private readonly cleanupListeners = new Map<string, CleanupListener>();
  private nextListenerId = 0;
  private txListenerId: Id;

  constructor(
    private readonly store: Store,
    private readonly tableName: string,
    private maxActions: number,
    private maxAge: number,
    private readonly generateId: () => string,
    private readonly getAuthor: () => string,
    private readonly bypassFn: (fn: () => void) => void
  ) {
    this.txListenerId = store.addWillFinishTransactionListener(() => {
      if (!this.pendingAction) return;

      const [, , changedCells, , changedValues] = store.getTransactionLog();

      const filteredCells = { ...changedCells };
      delete filteredCells[this.tableName];

      const hasCellChanges = Object.keys(filteredCells).length > 0;
      const hasValueChanges = Object.keys(changedValues).length > 0;

      if (!hasCellChanges && !hasValueChanges) return;

      const id = this.pendingAction;

      this.bypassFn(() => {
        store.setRow(this.tableName, id, {
          createdAt: Date.now(),
          delta: JSON.stringify(filteredCells),
          dv: JSON.stringify(changedValues),
          undone: 0,
          author: this.getAuthor(),
        });
      });

      this.pendingActionRecorded = true;
    });
  }

  action(mutate: () => void): Id | undefined {
    const id = this.generateId();

    const undoneIds = this.store
      .getRowIds(this.tableName)
      .filter(
        (rowId) => this.store.getCell(this.tableName, rowId, 'undone') === 1
      );
    if (undoneIds.length > 0) {
      this.bypassFn(() => {
        this.store.transaction(() => {
          for (const rowId of undoneIds) {
            this.store.delRow(this.tableName, rowId);
          }
        });
      });
    }

    this.pendingAction = id;
    this.pendingActionRecorded = false;
    try {
      this.store.transaction(() => mutate());
    } catch (err) {
      // TinyBase skips finishTransaction on throw, leaving the store
      // stuck. Manually finish so listeners fire and the store recovers.
      this.store.finishTransaction();
      this.pendingAction = undefined;
      throw err;
    }
    this.pendingAction = undefined;

    return this.pendingActionRecorded ? id : undefined;
  }

  goBackward(): this {
    const [, current] = this.getActionIds();
    if (!current) return this;

    const row = this.store.getRow(this.tableName, current);
    const delta = deserializeDelta(row.delta as string);
    const dv = deserializeDeltaValues(row.dv as string);

    this.store.transaction(() => {
      applyReverse(this.store, delta, dv);
      this.bypassFn(() => {
        this.store.setCell(this.tableName, current, 'undone', 1);
      });
    });

    return this;
  }

  goForward(): this {
    const [, , forward] = this.getActionIds();
    if (forward.length === 0) return this;

    const actionId = forward[0];
    const row = this.store.getRow(this.tableName, actionId);
    const delta = deserializeDelta(row.delta as string);
    const dv = deserializeDeltaValues(row.dv as string);

    this.store.transaction(() => {
      applyForward(this.store, delta, dv);
      this.bypassFn(() => {
        this.store.setCell(this.tableName, actionId, 'undone', 0);
      });
    });

    return this;
  }

  canGoBackward(): boolean {
    const [, current] = this.getActionIds();
    return current !== undefined;
  }

  canGoForward(): boolean {
    const [, , forward] = this.getActionIds();
    return forward.length > 0;
  }

  getActionIds(): [Id[], Id | undefined, Id[]] {
    const rowIds = this.store.getRowIds(this.tableName);
    const sorted = [...rowIds].sort(
      (a, b) =>
        (this.store.getCell(this.tableName, a, 'createdAt') as number) -
        (this.store.getCell(this.tableName, b, 'createdAt') as number)
    );

    let lastActiveIdx = -1;
    for (let i = sorted.length - 1; i >= 0; i--) {
      if (this.store.getCell(this.tableName, sorted[i], 'undone') === 0) {
        lastActiveIdx = i;
        break;
      }
    }

    const backward: Id[] = [];
    const forward: Id[] = [];

    for (let i = 0; i < sorted.length; i++) {
      const id = sorted[i];
      const undone = this.store.getCell(this.tableName, id, 'undone') === 1;
      if (undone && i > lastActiveIdx) {
        forward.push(id);
      } else if (!undone) {
        backward.push(id);
      }
    }

    const current = backward.pop();
    return [backward, current, forward];
  }

  setMaxActions(max: number): this {
    this.maxActions = max;
    return this;
  }

  setMaxAge(ms: number): this {
    this.maxAge = ms;
    return this;
  }

  cleanup(): this {
    runCleanup(
      this.store,
      this.tableName,
      this.maxActions,
      this.maxAge,
      this,
      this.cleanupListeners,
      this.bypassFn
    );
    return this;
  }

  addCleanupListener(listener: CleanupListener): Id {
    const id = String(this.nextListenerId++);
    this.cleanupListeners.set(id, listener);
    return id;
  }

  getStore(): Store {
    return this.store;
  }

  delListener(listenerId: Id): this {
    this.cleanupListeners.delete(listenerId);
    return this;
  }

  destroy(): void {
    this.store.delListener(this.txListenerId);
    this.cleanupListeners.clear();
  }
}
