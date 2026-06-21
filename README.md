# tinybase-mergeable-history

Persistent, syncable, **CRDT-aware** undo/redo history for [TinyBase](https://tinybase.org).

TinyBase's built-in [`Checkpoints`](https://tinybase.org/api/checkpoints/) keep an undo stack in memory: it is lost on reload, scoped to a single client, and unaware of `MergeableStore` merges. `tinybase-mergeable-history` takes the opposite approach — **history is stored as data inside the store itself** (in a `_history` table). Because the history lives in the store, it travels with:

- **any Persister** → undo/redo survives reloads
- **any Synchronizer** → undo/redo is shared across clients
- **`MergeableStore`** → undo/redo are ordinary mergeable mutations, so reverting an action on one client merges cleanly with concurrent edits on another instead of desyncing peers

## Comparison

|                              | Built-in `Checkpoints` | `tinybase-mergeable-history`          |
| ---------------------------- | ---------------------- | ------------------------------------- |
| Storage                      | in-memory              | as data in the store (`_history`)     |
| Survives reload              | ❌                     | ✅ (via any Persister)                |
| Shared across clients        | ❌                     | ✅ (via any Synchronizer)             |
| MergeableStore / CRDT-aware  | ❌                     | ✅                                    |
| Linear undo/redo             | ✅                     | ✅                                    |
| Count- and time-based pruning| ❌                     | ✅ (`maxActions`, `maxAge`)           |

## Install

```sh
pnpm add tinybase-mergeable-history tinybase
```

`tinybase` is a peer dependency (`^8.0.0`).

## Quick start

```ts
import { createStore } from 'tinybase';
import { createHistory } from 'tinybase-mergeable-history';

const store = createStore();
const history = createHistory(store);

// Wrap the mutations you want to be undoable in `action()`.
history.action(() => {
  store.setCell('pets', 'fido', 'sold', true);
});

history.canGoBackward(); // true
history.goBackward(); // undoes the action
history.canGoForward(); // true
history.goForward(); // redoes it
```

### With a MergeableStore (multi-client, CRDT)

```ts
import { createMergeableStore } from 'tinybase';
import { createHistory } from 'tinybase-mergeable-history';

const store = createMergeableStore('client-1');
const history = createHistory(store);

// Attach any persister / synchronizer as usual — the `_history`
// table travels with the store, so undo state persists and syncs,
// and undo/redo merge cleanly across clients.
```

## API

### `createHistory(store, options?): History`

| option        | default      | description                                          |
| ------------- | ------------ | ---------------------------------------------------- |
| `tableName`   | `'_history'` | table the history is stored in                       |
| `maxActions`  | `200`        | maximum number of actions retained                   |
| `maxAge`      | `30 days`    | maximum age (ms) of retained actions                 |
| `generateId`  | built-in     | action id generator                                  |
| `withBypass`  | `fn => fn()` | wrap internal writes (e.g. to bypass your listeners) |

### `History`

- `action(mutate): Id | undefined` — run `mutate` and record it as one undoable action
- `goBackward()` / `goForward()` — undo / redo
- `canGoBackward()` / `canGoForward(): boolean`
- `getActionIds(): [backward[], current, forward[]]`
- `setMaxActions(max)` / `setMaxAge(ms)` — tune retention
- `cleanup()` — prune now
- `addCleanupListener(listener)` / `delListener(id)` — observe pruning (cascade GC)
- `getStore(): Store`
- `destroy()` — remove listeners

### Schematized stores

If you use a Zod tables schema, spread in the history table schema so history writes are allowed:

```ts
import { historyTablesSchema } from 'tinybase-mergeable-history';

const tablesSchema = {
  ...historyTablesSchema,
  pets: z.object({ sold: z.boolean() }),
};
```

## How it works

Every `action()` runs inside a TinyBase transaction. A `willFinishTransaction` listener captures the transaction's cell and value changes and writes a single row to the history table holding the forward and reverse deltas plus an `undone` flag. Undo and redo are themselves ordinary store mutations that flip `undone` and re-apply the relevant delta — which is exactly why they persist, sync, and merge like any other data.

## License

MIT © INSP LLC
