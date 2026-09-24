import type * as React from 'react';
import { cn } from '@/lib/utils';

export function Label({ className, ...props }: React.ComponentProps<'label'>) {
  // biome-ignore lint/a11y/noLabelWithoutControl: 呼叫端以 htmlFor 關聯欄位
  return <label className={cn('font-medium text-[0.9em]', className)} {...props} />;
}
