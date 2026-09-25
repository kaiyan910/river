import type { QueryClient } from '@tanstack/react-query';
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Outlet,
  redirect,
} from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { z } from 'zod';
import { Toaster } from '@/components/toast';
import { meQueryOptions } from '@/lib/me';
import {
  canAccess,
  type NavItem,
  PARTICIPANTS,
  PLACEHOLDER_ITEMS,
  PROCESSES,
  ROLES,
} from '@/navigation';
import { ParticipantsPage } from '@/routes/admin/participants';
import { RolesPage } from '@/routes/admin/roles';
import { AppShell } from '@/routes/app-shell';
import { ProcessesPage } from '@/routes/designer/processes';
import { ForbiddenPage } from '@/routes/forbidden';
import { HomePage } from '@/routes/home';
import { InvitePage } from '@/routes/invite';
import { LoginPage } from '@/routes/login';
import { PlaceholderPage } from '@/routes/placeholder';
import { RequestsPage } from '@/routes/portal/requests';
import { StartPage } from '@/routes/portal/start';
import { TasksPage } from '@/routes/portal/tasks';

const rootRoute = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: () => (
    <>
      <Outlet />
      <Toaster />
    </>
  ),
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

/** 邀請信連結的落地頁；不需要登入。 */
const inviteRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/invite/$token',
  component: function Invite() {
    const { token } = inviteRoute.useParams();
    return <InvitePage token={token} />;
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

/** 沒有 item.requires 的 Permission 時顯示「沒有權限」；導覽列本來就不會出現這些項目。 */
function Guarded({ item, children }: { item: NavItem; children: ReactNode }) {
  const { me } = authenticatedRoute.useRouteContext();
  return canAccess(item, me.permissions) ? children : <ForbiddenPage item={item} />;
}

/** 目前選取的項目放在網址上，重新整理或分享連結時保持一致。 */
const selectionSearch = z.object({ id: z.string().optional() });

const participantsRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: '/admin/participants',
  validateSearch: selectionSearch,
  component: function Participants() {
    const { me } = authenticatedRoute.useRouteContext();
    const { id } = participantsRoute.useSearch();
    const navigate = participantsRoute.useNavigate();
    return (
      <Guarded item={PARTICIPANTS}>
        <ParticipantsPage
          me={me}
          selected={id}
          onSelect={(next) => navigate({ search: { id: next } })}
        />
      </Guarded>
    );
  },
});

const rolesRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: '/admin/roles',
  validateSearch: selectionSearch,
  component: function Roles() {
    const { id } = rolesRoute.useSearch();
    const navigate = rolesRoute.useNavigate();
    return (
      <Guarded item={ROLES}>
        <RolesPage selected={id} onSelect={(next) => navigate({ search: { id: next } })} />
      </Guarded>
    );
  },
});

const processesRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: '/designer/processes',
  validateSearch: selectionSearch,
  component: function Processes() {
    const { me } = authenticatedRoute.useRouteContext();
    const { id } = processesRoute.useSearch();
    const navigate = processesRoute.useNavigate();
    return (
      <Guarded item={PROCESSES}>
        <ProcessesPage
          me={me}
          selected={id}
          onSelect={(next) => navigate({ search: { id: next } })}
        />
      </Guarded>
    );
  },
});

const startRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: '/start',
  validateSearch: selectionSearch,
  component: function Start() {
    const { id } = startRoute.useSearch();
    const navigate = startRoute.useNavigate();
    return <StartPage selected={id} onSelect={(next) => navigate({ search: { id: next } })} />;
  },
});

const tasksRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: '/tasks',
  validateSearch: selectionSearch,
  component: function Tasks() {
    const { id } = tasksRoute.useSearch();
    const navigate = tasksRoute.useNavigate();
    return <TasksPage selected={id} onSelect={(next) => navigate({ search: { id: next } })} />;
  },
});

const requestsRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: '/requests',
  validateSearch: selectionSearch,
  component: function Requests() {
    const { id } = requestsRoute.useSearch();
    const navigate = requestsRoute.useNavigate();
    return <RequestsPage selected={id} onSelect={(next) => navigate({ search: { id: next } })} />;
  },
});

const placeholderRoutes = PLACEHOLDER_ITEMS.map((item) =>
  createRoute({
    getParentRoute: () => authenticatedRoute,
    path: item.to,
    component: () => (
      <Guarded item={item}>
        <PlaceholderPage item={item} />
      </Guarded>
    ),
  }),
);

const routeTree = rootRoute.addChildren([
  loginRoute,
  inviteRoute,
  authenticatedRoute.addChildren([
    homeRoute,
    participantsRoute,
    rolesRoute,
    processesRoute,
    startRoute,
    tasksRoute,
    requestsRoute,
    ...placeholderRoutes,
  ]),
]);

export function createAppRouter(queryClient: QueryClient) {
  return createRouter({ routeTree, context: { queryClient }, defaultPreload: 'intent' });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
