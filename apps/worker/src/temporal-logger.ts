import type { Logger as TemporalLogger } from '@temporalio/worker';
import type { Logger } from 'pino';

const LEVELS = {
  TRACE: 'trace',
  DEBUG: 'debug',
  INFO: 'info',
  WARN: 'warn',
  ERROR: 'error',
} as const;

/** 讓 Temporal SDK（含轉送過來的 Rust core log）也寫進同一個 pino，跟著 LOG_FORMAT 切換格式。 */
export function temporalLogger(logger: Logger): TemporalLogger {
  const log: TemporalLogger['log'] = (level, message, meta) =>
    logger[LEVELS[level]](meta ?? {}, message);
  return {
    log,
    trace: (message, meta) => log('TRACE', message, meta),
    debug: (message, meta) => log('DEBUG', message, meta),
    info: (message, meta) => log('INFO', message, meta),
    warn: (message, meta) => log('WARN', message, meta),
    error: (message, meta) => log('ERROR', message, meta),
  };
}
