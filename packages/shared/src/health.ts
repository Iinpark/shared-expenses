import { z } from 'zod';

/** Ответ GET /api/health — общий контракт сервера и клиента. */
export const healthResponseSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  db: z.enum(['up', 'down']),
  time: z.string(),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
