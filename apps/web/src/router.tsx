import type { QueryClient } from '@tanstack/react-query';
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Outlet,
  redirect,
} from '@tanstack/react-router';
import { z } from 'zod';
import { meQueryOptions } from '@/lib/me';
import { PLACEHOLDER_ITEMS } from '@/navigation';
import { AppShell } from '@/routes/app-shell';
import { HomePage } from '@/routes/home';
import { LoginPage } from '@/routes/login';
import { PlaceholderPage } from '@/routes/placeholder';

const rootRoute = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: Outlet,
});

/** 只接受站內路徑，避免登入後被導到外部網站。 */
function safeRedirect(target: string | undefined): string {
  return target?.startsWith('/') && !target.startsWith('//') ? target : '/';
}

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  validateSearch: z.object({ redirect: z.string().optional() }),
  beforeLoad: async ({ context, search }) => {
    const me = await context.queryClient.ensureQueryData(meQueryOptions);
    if (me) throw redirect({ href: safeRedirect(search.redirect) });
  },
  component: function Login() {
    const { redirect } = loginRoute.useSearch();
    return <LoginPage redirectTo={safeRedirect(redirect)} />;
  },
});

/** 需要登入的區域；未登入時導到登入頁，登入後回到原本的頁面。 */
const authenticatedRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'authenticated',
  beforeLoad: async ({ context, location }) => {
    const me = await context.queryClient.ensureQueryData(meQueryOptions);
    if (!me) throw redirect({ to: '/login', search: { redirect: location.href } });
    return { me };
  },
  component: function Authenticated() {
    const { me } = authenticatedRoute.useRouteContext();
    return <AppShell me={me} />;
  },
});

const homeRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: '/',
  component: HomePage,
});

const placeholderRoutes = PLACEHOLDER_ITEMS.map((item) =>
  createRoute({
    getParentRoute: () => authenticatedRoute,
    path: item.to,
    component: () => <PlaceholderPage item={item} />,
  }),
);

const routeTree = rootRoute.addChildren([
  loginRoute,
  authenticatedRoute.addChildren([homeRoute, ...placeholderRoutes]),
]);

export function createAppRouter(queryClient: QueryClient) {
  return createRouter({ routeTree, context: { queryClient }, defaultPreload: 'intent' });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
