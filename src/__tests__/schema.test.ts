import { describe, it, expect } from 'vitest';
import { historyTablesSchema } from '../schema';

describe('historyTablesSchema', () => {
  it('parses a complete _history row including author', () => {
    const row = {
      createdAt: 123,
      delta: '{}',
      dv: '{}',
      undone: 0,
      author: 'user-1',
    };

    expect(historyTablesSchema._history.parse(row)).toEqual(row);
  });

  it('fills author with an empty string when the cell is absent', () => {
    const parsed = historyTablesSchema._history.parse({
      createdAt: 123,
      delta: '{}',
      dv: '{}',
      undone: 0,
    });

    expect(parsed.author).toBe('');
  });
});
