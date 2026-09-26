import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createLogger, loggerEnvSchema } from './index.js';

function capture() {
  const lines: string[] = [];
  let buffer = '';
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      buffer += chunk.toString();
      const parts = buffer.split('\n');
      buffer = parts.pop() ?? '';
      lines.push(...parts);
      callback();
    },
  });
  return { stream, lines };
}

describe('loggerEnvSchema', () => {
  it('未設定時預設 json、info', () => {
    expect(loggerEnvSchema.parse({})).toEqual({ LOG_FORMAT: 'json', LOG_LEVEL: 'info' });
  });

  it('不接受未知的格式與等級', () => {
    expect(() => loggerEnvSchema.parse({ LOG_FORMAT: 'text' })).toThrow();
    expect(() => loggerEnvSchema.parse({ LOG_LEVEL: 'verbose' })).toThrow();
  });
});

describe('createLogger', () => {
  it('json 格式每行輸出一個 JSON 物件', () => {
    const { stream, lines } = capture();
    const logger = createLogger({ LOG_FORMAT: 'json', LOG_LEVEL: 'info' }, 'api', {
      destination: stream,
    });

    logger.info({ taskQueue: 'river' }, 'worker started');

    expect(JSON.parse(lines[0] ?? '')).toMatchObject({
      level: 30,
      name: 'api',
      msg: 'worker started',
      taskQueue: 'river',
    });
  });

  it('pretty 格式：本機時間、等級、來源、訊息在同一行，不含 pid／hostname', () => {
    const { stream, lines } = capture();
    const logger = createLogger({ LOG_FORMAT: 'pretty', LOG_LEVEL: 'info' }, 'worker', {
      destination: stream,
      colorize: false,
    });

    logger.info({ taskQueue: 'river' }, 'worker started');

    expect(lines[0]).toMatch(/^\d{2}:\d{2}:\d{2}\.\d{3} INFO +\[worker\] worker started$/);
    expect(lines.slice(1).join('\n')).toContain('taskQueue: "river"');
    expect(lines.join('\n')).not.toMatch(/pid|hostname/);
  });

  it('pretty 格式把 Nest 的 context 放在訊息前，不另外列一行', () => {
    const { stream, lines } = capture();
    const logger = createLogger({ LOG_FORMAT: 'pretty', LOG_LEVEL: 'info' }, 'api', {
      destination: stream,
      colorize: false,
    });

    logger.info({ context: 'RoutesResolver' }, 'HealthController {/api/health}');

    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/INFO +\[api\] RoutesResolver: HealthController \{\/api\/health\}$/);
  });

  it('pretty 格式不印 pino-http 的 req／res 細節', () => {
    const { stream, lines } = capture();
    const logger = createLogger({ LOG_FORMAT: 'pretty', LOG_LEVEL: 'info' }, 'api', {
      destination: stream,
      colorize: false,
    });

    logger.info(
      { req: { id: 1, headers: { cookie: 'secret' } }, res: { statusCode: 200 }, responseTime: 12 },
      'GET /api/requests 200 12ms',
    );

    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/\[api\] GET \/api\/requests 200 12ms$/);
  });

  it('pretty 格式把 error stack 多行展開', () => {
    const { stream, lines } = capture();
    const logger = createLogger({ LOG_FORMAT: 'pretty', LOG_LEVEL: 'info' }, 'api', {
      destination: stream,
      colorize: false,
    });

    logger.error({ err: new Error('boom') }, 'Request failed');

    expect(lines[0]).toMatch(/ERROR +\[api\] Request failed$/);
    expect(lines.join('\n')).toMatch(/Error: boom\n\s+at /);
  });

  it('低於 LOG_LEVEL 的 log 不輸出', () => {
    const { stream, lines } = capture();
    const logger = createLogger({ LOG_FORMAT: 'json', LOG_LEVEL: 'warn' }, 'api', {
      destination: stream,
    });

    logger.info('hidden');
    logger.warn('shown');

    expect(lines.map((l) => JSON.parse(l).msg)).toEqual(['shown']);
  });
});
