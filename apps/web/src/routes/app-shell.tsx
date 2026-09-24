import type { MeResponse } from '@river/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { Link, Outlet, useNavigate } from '@tanstack/react-router';
import { LogOut } from 'lucide-react';
import { Fragment } from 'react';
import { Logo } from '@/components/logo';
import { authClient } from '@/lib/auth-client';
import { visibleNavGroups } from '@/navigation';

/** 登入後的外框：C「控制台」版面的 icon rail，右側兩欄由各頁面決定。 */
export function AppShell({ me }: { me: MeResponse }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  async function signOut() {
    await authClient.signOut();
    queryClient.clear();
    await navigate({ to: '/login' });
  }

  return (
    <div className="grid min-h-screen grid-cols-1 md:h-screen md:grid-cols-[56px_300px_minmax(0,1fr)] xl:grid-cols-[56px_360px_minmax(0,1fr)]">
      <nav
        aria-label="主要導覽"
        className="sticky top-0 z-10 flex items-center gap-1 overflow-x-auto border-sidebar-border border-b bg-sidebar px-2 py-1.5 text-sidebar-foreground md:static md:flex-col md:border-r md:border-b-0 md:px-0 md:py-3"
      >
        <div className="mx-1.5 grid h-[38px] place-items-center text-sidebar-primary md:mx-0 md:mb-3">
          <Logo />
        </div>
        {visibleNavGroups(me.permissions).map((group, i) => (
          <Fragment key={group[0]?.to}>
            {i > 0 && (
              <div className="my-1.5 hidden h-px w-[22px] shrink-0 bg-sidebar-border md:block" />
            )}
            {group.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                title={item.label}
                aria-label={item.label}
                activeOptions={{ exact: item.to === '/' }}
                className="relative grid size-[38px] shrink-0 place-items-center rounded-lg text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground data-[status=active]:bg-sidebar-accent data-[status=active]:text-sidebar-accent-foreground md:data-[status=active]:before:absolute md:data-[status=active]:before:top-[9px] md:data-[status=active]:before:bottom-[9px] md:data-[status=active]:before:left-[-9px] md:data-[status=active]:before:w-0.5 md:data-[status=active]:before:rounded-sm md:data-[status=active]:before:bg-sidebar-primary"
              >
                <item.icon size={18} strokeWidth={1.75} aria-hidden />
              </Link>
            ))}
          </Fragment>
        ))}
        <div className="flex-1" />
        <button
          type="button"
          onClick={signOut}
          title="登出"
          aria-label="登出"
          className="grid size-[38px] shrink-0 cursor-pointer place-items-center rounded-lg text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        >
          <LogOut size={18} strokeWidth={1.75} aria-hidden />
        </button>
        <div
          title={`${me.name} · ${me.email}`}
          className="ml-1 grid size-[30px] shrink-0 place-items-center rounded-full bg-sidebar-accent font-semibold text-[0.8em] text-sidebar-accent-foreground md:mt-1.5 md:ml-0"
        >
          {me.name.slice(0, 1)}
        </div>
      </nav>
      <Outlet />
    </div>
  );
}
