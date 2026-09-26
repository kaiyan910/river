import type { MeResponse } from '@river/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { Link, Outlet, useNavigate } from '@tanstack/react-router';
import { LogOut, ShieldAlert, ShieldCheck } from 'lucide-react';
import { Fragment } from 'react';
import { Logo } from '@/components/logo';
import { authClient } from '@/lib/auth-client';
import { needsTotpSetup } from '@/lib/me';
import { cn } from '@/lib/utils';
import { ACCOUNT_SECURITY_PATH, visibleNavGroups } from '@/navigation';
import { MobileNav } from './mobile-nav';

/** 登入後的外框：C「控制台」版面的 icon rail，右側兩欄由各頁面決定；手機版改用 MobileNav。 */
export function AppShell({ me }: { me: MeResponse }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const totpPending = needsTotpSetup(me);

  async function signOut() {
    await authClient.signOut();
    queryClient.clear();
    await navigate({ to: '/login' });
  }

  return (
    // 手機版是 flex column：header 與清單照內容高度，最後一個區塊撐滿剩下的高度，避免 grid 把多的高度平均分給每一列。
    <div className="flex min-h-screen flex-col *:last:flex-1 md:grid md:h-screen md:grid-cols-[56px_300px_minmax(0,1fr)] xl:grid-cols-[56px_360px_minmax(0,1fr)]">
      <MobileNav me={me} totpPending={totpPending} onSignOut={signOut} />
      <nav
        aria-label="主要導覽"
        className="hidden flex-col items-center gap-1 border-sidebar-border border-r bg-sidebar py-3 text-sidebar-foreground md:flex"
      >
        <div className="mb-3 grid h-[38px] place-items-center text-sidebar-primary">
          <Logo />
        </div>
        {visibleNavGroups(me.permissions).map((group, i) => (
          <Fragment key={group[0]?.to}>
            {i > 0 && <div className="my-1.5 h-px w-[22px] shrink-0 bg-sidebar-border" />}
            {group.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                title={item.label}
                aria-label={item.label}
                activeOptions={{ exact: item.to === '/' }}
                className="relative grid size-[38px] shrink-0 place-items-center rounded-lg text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground data-[status=active]:bg-sidebar-accent data-[status=active]:text-sidebar-accent-foreground data-[status=active]:before:absolute data-[status=active]:before:top-[9px] data-[status=active]:before:bottom-[9px] data-[status=active]:before:left-[-9px] data-[status=active]:before:w-0.5 data-[status=active]:before:rounded-sm data-[status=active]:before:bg-sidebar-primary"
              >
                <item.icon size={18} strokeWidth={1.75} aria-hidden />
              </Link>
            ))}
          </Fragment>
        ))}
        <div className="flex-1" />
        <Link
          to={ACCOUNT_SECURITY_PATH}
          title={totpPending ? '帳號安全：請先啟用兩步驟驗證' : '帳號安全'}
          aria-label={totpPending ? '帳號安全（需要啟用兩步驟驗證）' : '帳號安全'}
          className={cn(
            'relative grid size-[38px] shrink-0 place-items-center rounded-lg text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground data-[status=active]:bg-sidebar-accent data-[status=active]:text-sidebar-accent-foreground',
            totpPending && 'text-status-returned',
          )}
        >
          {totpPending ? (
            <ShieldAlert size={18} strokeWidth={1.75} aria-hidden />
          ) : (
            <ShieldCheck size={18} strokeWidth={1.75} aria-hidden />
          )}
        </Link>
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
          className="mt-1.5 grid size-[30px] shrink-0 place-items-center rounded-full bg-sidebar-accent font-semibold text-[0.8em] text-sidebar-accent-foreground"
        >
          {me.name.slice(0, 1)}
        </div>
      </nav>
      {totpPending ? (
        // 持有需要 TOTP 的 Permission 但還沒啟用：在每一頁上方提醒，直到完成設定。
        <div className="flex min-h-0 flex-col md:col-span-2">
          <div
            role="status"
            className="flex flex-wrap items-center gap-x-3 gap-y-1 border-status-returned/30 border-b bg-status-returned/10 px-4 py-2 text-[0.93em]"
          >
            <ShieldAlert size={16} aria-hidden className="shrink-0 text-status-returned" />
            <span className="flex-1">
              你持有需要兩步驟驗證的 Permission，啟用之前無法使用發佈 Process、管理人員或 Credential
              等功能。
            </span>
            <Link to={ACCOUNT_SECURITY_PATH} className="font-medium text-primary hover:underline">
              立即設定
            </Link>
          </div>
          <div className="flex min-h-0 flex-1 flex-col *:last:flex-1 md:grid md:grid-cols-[300px_minmax(0,1fr)] xl:grid-cols-[360px_minmax(0,1fr)]">
            <Outlet />
          </div>
        </div>
      ) : (
        <Outlet />
      )}
    </div>
  );
}
