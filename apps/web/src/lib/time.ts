const dateTime = new Intl.DateTimeFormat('zh-TW', {
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/** 09/25 14:03 */
export const formatTime = (iso: string) => dateTime.format(new Date(iso));

const relative = new Intl.RelativeTimeFormat('zh-TW', { numeric: 'auto' });
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** 剛剛、5 分鐘前、3 小時前、昨天… */
export function timeAgo(iso: string, now = Date.now()): string {
  const diff = new Date(iso).getTime() - now;
  const abs = Math.abs(diff);
  if (abs < MINUTE) return '剛剛';
  if (abs < HOUR) return relative.format(Math.round(diff / MINUTE), 'minute');
  if (abs < DAY) return relative.format(Math.round(diff / HOUR), 'hour');
  return relative.format(Math.round(diff / DAY), 'day');
}
