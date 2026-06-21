import { z } from 'zod';

/**
 * Zod schema for the history table.
 * Spread into your store's Zod tables schema to allow history writes.
 *
 * Usage:
 *   const myTablesSchema = { ...historyTablesSchema, yourTable: z.object({...}) };
 */
export const historyTablesSchema = {
  _history: z.object({
    createdAt: z.number(),
    delta: z.string(),
    dv: z.string(),
    undone: z.number(),
  }),
};
