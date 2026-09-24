import type * as React from 'react';

/** 開關；本身是 checkbox，外層用 label 包住即可點整列切換。 */
export function Switch(props: Omit<React.ComponentProps<'input'>, 'type'>) {
  return (
    <span className="relative inline-flex shrink-0">
      <input
        type="checkbox"
        role="switch"
        aria-checked={props.checked}
        className="peer sr-only"
        {...props}
      />
      <span className="h-[20px] w-[36px] rounded-full bg-input transition-colors peer-checked:bg-primary peer-focus-visible:outline-2 peer-focus-visible:outline-ring peer-focus-visible:outline-offset-2 peer-disabled:opacity-50" />
      <span className="pointer-events-none absolute top-[2px] left-[2px] size-[16px] rounded-full bg-card shadow transition-transform peer-checked:translate-x-[16px]" />
    </span>
  );
}
