import { createAuthClient } from 'better-auth/react';

// web 與 api 在同一個網域（Caddy 或 Vite proxy），所以直接用目前的 origin。
export const authClient = createAuthClient({ basePath: '/api/auth' });
