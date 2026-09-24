export function Logo({ size = 22 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M3 8c3-2.5 6 2.5 9 0s6-2.5 9 0" />
      <path d="M3 14c3-2.5 6 2.5 9 0s6-2.5 9 0" />
      <path d="M3 20c3-2.5 6 2.5 9 0s6-2.5 9 0" opacity=".45" />
    </svg>
  );
}
