import type { Store } from 'tinybase';
import type { ParsedDelta, ParsedDeltaValues } from './types';

export function deserializeDelta(json: string): ParsedDelta {
  return JSON.parse(json);
}

export function deserializeDeltaValues(json: string): ParsedDeltaValues {
  return JSON.parse(json);
}

function applyDelta(
  store: Store,
  delta: ParsedDelta,
  dv: ParsedDeltaValues,
  index: 0 | 1
): void {
  for (const tableId of Object.keys(delta)) {
    for (const rowId of Object.keys(delta[tableId])) {
      for (const cellId of Object.keys(delta[tableId][rowId])) {
        const value = delta[tableId][rowId][cellId][index];
        if (value == null) {
          store.delCell(tableId, rowId, cellId, true);
        } else {
          store.setCell(tableId, rowId, cellId, value);
        }
      }
    }
  }
  for (const valueId of Object.keys(dv)) {
    const value = dv[valueId][index];
    if (value == null) {
      store.delValue(valueId);
    } else {
      store.setValue(valueId, value);
    }
  }
}

export function applyReverse(
  store: Store,
  delta: ParsedDelta,
  dv: ParsedDeltaValues
): void {
  applyDelta(store, delta, dv, 0);
}

export function applyForward(
  store: Store,
  delta: ParsedDelta,
  dv: ParsedDeltaValues
): void {
  applyDelta(store, delta, dv, 1);
}
