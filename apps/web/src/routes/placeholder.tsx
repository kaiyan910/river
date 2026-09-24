import type { NavItem } from '@/navigation';

/** 路由與導覽已經接好、內容由後續 ticket 實作的佔位頁；橫跨清單與詳情兩欄。 */
export function PlaceholderPage({ item }: { item: NavItem }) {
  return (
    <section className="overflow-auto md:col-span-2">
      <div className="grid min-h-[50vh] place-items-center content-center gap-2.5 px-4 py-16 text-center">
        <div className="grid size-14 place-items-center rounded-[calc(var(--radius)+6px)] bg-muted text-muted-foreground">
          <item.icon size={26} aria-hidden />
        </div>
        <h1 className="font-semibold text-[1.3em]">{item.label}</h1>
        <p className="max-w-[36em] text-muted-foreground">這個頁面還在建置中。</p>
      </div>
    </section>
  );
}
