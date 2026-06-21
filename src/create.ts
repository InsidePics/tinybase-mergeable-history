import type { Store } from 'tinybase';
import type { History as IHistory, HistoryOptions } from './types';
import { History } from './history';

const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;

let counter = 0;
function defaultGenerateId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${ts}-${rand}-${String(++counter).padStart(4, '0')}`;
}

export function createHistory(
  store: Store,
  options?: HistoryOptions
): IHistory {
  return new History(
    store,
    options?.tableName ?? '_history',
    options?.maxActions ?? 200,
    options?.maxAge ?? THIRTY_DAYS,
    options?.generateId ?? defaultGenerateId,
    options?.getAuthor ?? (() => ''),
    options?.withBypass ?? ((fn: () => void) => fn())
  );
}
