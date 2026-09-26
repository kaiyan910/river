import { type DestinationStream, type Logger, pino } from 'pino';
import { build as pretty } from 'pino-pretty';
import { z } from 'zod';

export const loggerEnvSchema = z.object({
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']).default('info'),
  /** json 給 log 收集工具解析；pretty 給人在終端機看。 */
  LOG_FORMAT: z.enum(['json', 'pretty']).default('json'),
});

export type LoggerEnv = z.infer<typeof loggerEnvSchema>;

export interface CreateLoggerOptions {
  /** 預設為 stdout；測試用來攔截輸出。 */
  destination?: DestinationStream;
  /** 只影響 pretty；預設依終端機是否支援顏色決定。 */
  colorize?: boolean;
}

/**
 * 建立 api／worker 共用的 pino logger。`name` 是 log 的來源，pretty 模式會印在每行訊息前。
 *
 * pretty 模式在主執行緒同步格式化（不用 transport），才能用函式自訂訊息格式；它只在本機開發使用，效能不是重點。
 */
export function createLogger(
  env: LoggerEnv,
  name: string,
  options: CreateLoggerOptions = {},
): Logger {
  const base = { name, level: env.LOG_LEVEL };
  if (env.LOG_FORMAT === 'json') {
    return options.destination ? pino(base, options.destination) : pino(base);
  }
  return pino(
    base,
    pretty({
      destination: options.destination ?? 1,
      sync: true,
      ...(options.colorize === undefined ? {} : { colorize: options.colorize }),
      // 時間與等級也在 messageFormat 裡排版：交給 pino-pretty 的話，它會在訊息前硬加一個冒號。
      // req／res 是 pino-http 附上的完整 request 細節，pretty 模式只看訊息那一行。
      ignore: 'time,level,pid,hostname,name,context,req,res,responseTime',
      messageFormat: (log, messageKey, _levelLabel, { colors }) => {
        const level = LEVELS[log.level as number] ?? { label: 'USERLVL', color: 'white' };
        const context = typeof log.context === 'string' ? `${log.context}: ` : '';
        return [
          colors.gray(formatTime(log.time as number)),
          colors[level.color](level.label.padEnd(5)),
          colors.cyan(`[${log.name}]`),
          `${context}${log[messageKey]}`,
        ].join(' ');
      },
    }),
  );
}

const LEVELS: Record<
  number,
  { label: string; color: 'gray' | 'blue' | 'green' | 'yellow' | 'red' | 'bgRed' }
> = {
  10: { label: 'TRACE', color: 'gray' },
  20: { label: 'DEBUG', color: 'blue' },
  30: { label: 'INFO', color: 'green' },
  40: { label: 'WARN', color: 'yellow' },
  50: { label: 'ERROR', color: 'red' },
  60: { label: 'FATAL', color: 'bgRed' },
};

/** 本機時間 HH:MM:ss.l */
function formatTime(epochMs: number): string {
  const d = new Date(epochMs);
  const pad = (n: number, width = 2) => String(n).padStart(width, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}
