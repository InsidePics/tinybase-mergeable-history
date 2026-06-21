import type { Store } from 'tinybase';
import type { History, CleanedAction, CleanupListener } from './types';

export function runCleanup(
  store: Store,
  tableName: string,
  maxActions: number,
  maxAge: number,
  history: History,
  listeners: Map<string, CleanupListener>,
  withBypass: (fn: () => void) => void
): void {
  const now = Date.now();
  const rowIds = store.getRowIds(tableName);

  const actions = rowIds.map((id) => ({
    id,
    createdAt: store.getCell(tableName, id, 'createdAt') as number,
    undone: store.getCell(tableName, id, 'undone') as number,
    delta: store.getCell(tableName, id, 'delta') as string,
    dv: store.getCell(tableName, id, 'dv') as string,
  }));

  actions.sort((a, b) => a.createdAt - b.createdAt);

  const toRemoveSet = new Set<string>();

  for (const action of actions) {
    if (now - action.createdAt > maxAge) {
      toRemoveSet.add(action.id);
    }
  }

  const remaining = actions.filter((a) => !toRemoveSet.has(a.id));
  if (remaining.length > maxActions) {
    const excess = remaining.length - maxActions;
    for (let i = 0; i < excess; i++) {
      toRemoveSet.add(remaining[i].id);
    }
  }

  if (toRemoveSet.size === 0) return;

  const toRemove = actions.filter((a) => toRemoveSet.has(a.id));

  const cleaned: CleanedAction[] = toRemove.map((a) => ({
    id: a.id,
    createdAt: a.createdAt,
    undone: a.undone === 1,
    delta: a.delta,
    deltaValues: a.dv,
  }));

  for (const listener of Array.from(listeners.values())) {
    listener(history, cleaned);
  }

  withBypass(() => {
    store.transaction(() => {
      for (const action of toRemove) {
        store.delRow(tableName, action.id);
      }
    });
  });
}
