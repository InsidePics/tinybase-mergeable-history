import type { Store, Id } from 'tinybase';

export interface HistoryOptions {
  tableName?: string;
  maxActions?: number;
  maxAge?: number;
  generateId?: () => string;
  withBypass?: (fn: () => void) => void;
}

export interface History {
  action(mutate: () => void): Id | undefined;
  goBackward(): this;
  goForward(): this;
  canGoBackward(): boolean;
  canGoForward(): boolean;
  getActionIds(): [Id[], Id | undefined, Id[]];
  setMaxActions(max: number): this;
  setMaxAge(ms: number): this;
  cleanup(): this;
  addCleanupListener(listener: CleanupListener): Id;
  getStore(): Store;
  delListener(listenerId: Id): this;
  destroy(): void;
}

export type CleanupListener = (
  history: History,
  actions: CleanedAction[]
) => void;

export interface CleanedAction {
  id: string;
  createdAt: number;
  undone: boolean;
  delta: string;
  deltaValues: string;
}

export type ParsedDelta = {
  [tableId: string]: {
    [rowId: string]: {
      [cellId: string]: [
        old: string | number | boolean | null,
        new: string | number | boolean | null,
      ];
    };
  };
};

export type ParsedDeltaValues = {
  [valueId: string]: [
    old: string | number | boolean | null,
    new: string | number | boolean | null,
  ];
};
