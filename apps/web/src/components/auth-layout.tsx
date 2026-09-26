import type { ReactNode } from 'react';
import { Logo } from '@/components/logo';

/** 未登入頁面（忘記密碼、重設密碼）共用的 A「清流」分割式版面：左側品牌色塊與標語、右側內容。 */
export function AuthLayout({ tagline, children }: { tagline: ReactNode; children: ReactNode }) {
  return (
    <div className="grid min-h-screen min-[820px]:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
      <aside className="hidden flex-col justify-between gap-10 bg-brand px-12 py-10 text-brand-foreground min-[820px]:flex">
        <div className="flex items-center gap-2 font-bold text-[1.1em]">
          <Logo /> River
        </div>
        <h2 className="font-semibold text-[2em] tracking-[-0.02em]">{tagline}</h2>
        <p className="text-[0.86em] opacity-65">公司內部系統 · 僅限員工使用</p>
      </aside>

      <main className="grid place-items-center px-4 pt-8 pb-16">
        <div className="w-full max-w-[360px]">
          <div className="mb-7 flex items-center gap-2 font-bold text-[1.1em] text-primary min-[820px]:hidden">
            <Logo /> <span className="text-foreground">River</span>
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}
