import { z } from 'zod';

/**
 * Process DSL 的骨架。節點類型、連線條件與發佈前檢查由後續 ticket 補上。
 */
export const processDslSchema = z.object({
  nodes: z.array(z.object({ id: z.string(), type: z.string() })),
  edges: z.array(z.object({ id: z.string(), source: z.string(), target: z.string() })),
});

export type ProcessDsl = z.infer<typeof processDslSchema>;
