import { CircleAlert, CircleCheck } from 'lucide-react';
import { useSyncExternalStore } from 'react';
import { cn } from '@/lib/utils';

interface Toast {
  id: number;
  text: string;
  tone: 'success' | 'error';
}

let toasts: Toast[] = [];
let seq = 0;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

/** 在右下角顯示幾秒鐘的操作結果。 */
export function toast(text: string, tone: Toast['tone'] = 'success') {
  const id = ++seq;
  toasts = [...toasts, { id, text, tone }];
  emit();
  setTimeout(
    () => {
      toasts = toasts.filter((t) => t.id !== id);
      emit();
    },
    tone === 'error' ? 6000 : 3000,
  );
}

export function Toaster() {
  const list = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => toasts,
  );
  return (
    <div
      aria-live="polite"
      className="fixed right-4 bottom-4 z-50 grid max-w-[min(420px,calc(100vw-2rem))] gap-2"
    >
      {list.map((t) => (
        <div
          key={t.id}
          role={t.tone === 'error' ? 'alert' : 'status'}
          className="flex items-start gap-2 rounded-lg border bg-card px-3 py-2 text-[0.93em] shadow-[0_6px_20px_color-mix(in_oklch,var(--foreground)_12%,transparent)]"
        >
          {t.tone === 'error' ? (
            <CircleAlert size={16} aria-hidden className={cn('mt-0.5 shrink-0 text-destructive')} />
          ) : (
            <CircleCheck size={16} aria-hidden className="mt-0.5 shrink-0 text-status-approved" />
          )}
          {t.text}
        </div>
      ))}
    </div>
  );
}
