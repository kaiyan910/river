import type { MeResponse } from '@river/contracts';
import { Link, useRouterState } from '@tanstack/react-router';
import { LogOut, Menu, ShieldAlert, ShieldCheck, X } from 'lucide-react';
import { Fragment, useEffect, useRef, useState } from 'react';
import { Logo } from '@/components/logo';
import { cn } from '@/lib/utils';
import { ACCOUNT_SECURITY_PATH, currentPageLabel, visibleNavGroups } from '@/navigation';

const ITEM_CLASS =
  'flex h-10 items-center gap-3 rounded-lg px-3 text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground data-[status=active]:bg-sidebar-accent data-[status=active]:font-medium data-[status=active]:text-sidebar-accent-foreground';

/** 手機版（< md）的頂部列與左側滑出的導覽 drawer；md 以上改用 AppShell 的 icon rail。 */
export function MobileNav({
  me,
  totpPending,
  onSignOut,
}: {
  me: MeResponse;
  totpPending: boolean;
  onSignOut: () => void;
}) {
  const [open, setOpen] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const menuButton = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);

  // 換頁（包含瀏覽器上一頁）就關閉。
  // biome-ignore lint/correctness/useExhaustiveDependencies: pathname 變動時才需要關閉
  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    if (open) {
      closeButton.current?.focus();
      const overflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
      document.addEventListener('keydown', onKey);
      wasOpen.current = true;
      return () => {
        document.body.style.overflow = overflow;
        document.removeEventListener('keydown', onKey);
      };
    }
    // 關閉時把焦點還給 ☰（第一次渲染不搶焦點）。
    if (wasOpen.current) menuButton.current?.focus();
  }, [open]);

  const close = () => setOpen(false);

  return (
    <>
      <header className="sticky top-0 z-10 flex h-12 items-center gap-2 border-sidebar-border border-b bg-sidebar px-2 text-sidebar-foreground md:hidden">
        <button
          ref={menuButton}
          type="button"
          onClick={() => setOpen(true)}
          aria-label={totpPending ? '開啟選單（需要啟用兩步驟驗證）' : '開啟選單'}
          aria-expanded={open}
          aria-controls="mobile-nav"
          className="relative grid size-[38px] shrink-0 cursor-pointer place-items-center rounded-lg hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        >
          <Menu size={20} strokeWidth={1.75} aria-hidden />
          {totpPending && (
            <span className="absolute top-[7px] right-[7px] size-2 rounded-full bg-status-returned ring-2 ring-sidebar" />
          )}
        </button>
        <span className="text-sidebar-primary">
          <Logo />
        </span>
        <span className="truncate font-semibold">{currentPageLabel(pathname)}</span>
      </header>

      <div
        className={cn('fixed inset-0 z-50 md:hidden', !open && 'pointer-events-none')}
        inert={!open}
      >
        <div
          aria-hidden
          onClick={close}
          className={cn(
            'absolute inset-0 bg-black/30 transition-opacity duration-200',
            open ? 'opacity-100' : 'opacity-0',
          )}
        />
        <div
          id="mobile-nav"
          role="dialog"
          aria-modal
          aria-label="主要導覽"
          className={cn(
            'absolute inset-y-0 left-0 flex w-[280px] max-w-[85vw] flex-col border-sidebar-border border-r bg-sidebar text-sidebar-foreground shadow-xl transition-transform duration-200',
            open ? 'translate-x-0' : '-translate-x-full',
          )}
        >
          <div className="flex h-12 shrink-0 items-center gap-2 border-sidebar-border border-b px-3">
            <span className="text-sidebar-primary">
              <Logo />
            </span>
            <span className="flex-1 font-semibold">River</span>
            <button
              ref={closeButton}
              type="button"
              onClick={close}
              aria-label="關閉選單"
              className="grid size-[34px] cursor-pointer place-items-center rounded-lg hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            >
              <X size={18} strokeWidth={1.75} aria-hidden />
            </button>
          </div>

          <nav aria-label="主要導覽" className="flex-1 overflow-y-auto p-2">
            {visibleNavGroups(me.permissions).map((group, i) => (
              <Fragment key={group[0]?.to}>
                {i > 0 && <div className="mx-3 my-2 h-px bg-sidebar-border" />}
                {group.map((item) => (
                  <Link
                    key={item.to}
                    to={item.to}
                    onClick={close}
                    activeOptions={{ exact: item.to === '/' }}
                    className={ITEM_CLASS}
                  >
                    <item.icon size={18} strokeWidth={1.75} aria-hidden className="shrink-0" />
                    <span className="truncate">{item.label}</span>
                  </Link>
                ))}
              </Fragment>
            ))}
          </nav>

          <div className="shrink-0 border-sidebar-border border-t p-2">
            <div className="flex items-center gap-3 px-3 py-2">
              <div className="grid size-[30px] shrink-0 place-items-center rounded-full bg-sidebar-accent font-semibold text-[0.8em] text-sidebar-accent-foreground">
                {me.name.slice(0, 1)}
              </div>
              <div className="min-w-0">
                <div className="truncate font-medium">{me.name}</div>
                <div className="truncate text-[0.85em] text-muted-foreground">{me.email}</div>
              </div>
            </div>
            <Link
              to={ACCOUNT_SECURITY_PATH}
              onClick={close}
              className={cn(ITEM_CLASS, totpPending && 'text-status-returned')}
            >
              {totpPending ? (
                <ShieldAlert size={18} strokeWidth={1.75} aria-hidden className="shrink-0" />
              ) : (
                <ShieldCheck size={18} strokeWidth={1.75} aria-hidden className="shrink-0" />
              )}
              <span>{totpPending ? '帳號安全（需要啟用兩步驟驗證）' : '帳號安全'}</span>
            </Link>
            <button
              type="button"
              onClick={onSignOut}
              className={cn(ITEM_CLASS, 'w-full cursor-pointer')}
            >
              <LogOut size={18} strokeWidth={1.75} aria-hidden className="shrink-0" />
              <span>登出</span>
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
