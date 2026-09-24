import type * as React from 'react';
import { cn } from '@/lib/utils';

export function Input({ className, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      className={cn(
        'h-[2.6em] w-full rounded-lg border border-input bg-card px-[0.8em] text-foreground transition-[border-color,box-shadow] placeholder:text-muted-foreground/80 focus:border-ring focus:shadow-[0_0_0_3px_color-mix(in_oklch,var(--ring)_28%,transparent)] focus:outline-none aria-invalid:border-destructive',
        className,
      )}
      {...props}
    />
  );
}
