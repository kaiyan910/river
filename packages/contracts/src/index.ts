import { PERMISSIONS } from '@river/auth';
import { z } from 'zod';

/** `GET /api/me`：目前登入的 Participant。 */
export const meResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.email(),
  permissions: z.array(z.enum(PERMISSIONS)),
});

export type MeResponse = z.infer<typeof meResponseSchema>;
