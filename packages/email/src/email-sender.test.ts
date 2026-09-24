import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { SMTPServer } from 'smtp-server';
import { afterEach, describe, expect, it } from 'vitest';
import { createEmailSender, emailEnvSchema } from './index.js';

const MESSAGE = {
  to: 'someone@river.test',
  subject: '你已受邀加入 River',
  html: '<p>點這裡設定密碼</p>',
  text: '點這裡設定密碼',
};

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((c) => c()));
});

describe('EmailSender', () => {
  it('EMAIL_TRANSPORT=smtp 時經由 SMTP 寄出', async () => {
    const received: string[] = [];
    const smtp = new SMTPServer({
      authOptional: true,
      disabledCommands: ['STARTTLS'],
      onData(stream, _session, callback) {
        let raw = '';
        stream.on('data', (chunk: Buffer) => {
          raw += chunk.toString();
        });
        stream.on('end', () => {
          received.push(raw);
          callback();
        });
      },
    });
    await new Promise<void>((resolve) => smtp.listen(0, '127.0.0.1', resolve));
    cleanups.push(() => new Promise((resolve) => smtp.close(() => resolve())));
    const { port } = smtp.server.address() as AddressInfo;

    const sender = createEmailSender(
      emailEnvSchema.parse({
        EMAIL_TRANSPORT: 'smtp',
        EMAIL_FROM: 'River <river@river.test>',
        SMTP_URL: `smtp://127.0.0.1:${port}`,
      }),
    );
    await sender.send(MESSAGE);

    expect(received).toHaveLength(1);
    expect(received[0]).toMatch(/^To: someone@river\.test/m);
    expect(received[0]).toMatch(/^From: River <river@river\.test>/m);
  });

  it('EMAIL_TRANSPORT=resend 時呼叫 Resend API', async () => {
    const requests: { path?: string; auth?: string; body: Record<string, unknown> }[] = [];
    const api: Server = createServer((req, res) => {
      let raw = '';
      req.on('data', (chunk: Buffer) => {
        raw += chunk.toString();
      });
      req.on('end', () => {
        requests.push({ path: req.url, auth: req.headers.authorization, body: JSON.parse(raw) });
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ id: 'email_1' }));
      });
    });
    await new Promise<void>((resolve) => api.listen(0, '127.0.0.1', resolve));
    cleanups.push(() => new Promise((resolve) => api.close(() => resolve())));
    const { port } = api.address() as AddressInfo;

    const sender = createEmailSender(
      emailEnvSchema.parse({
        EMAIL_TRANSPORT: 'resend',
        EMAIL_FROM: 'River <river@river.test>',
        RESEND_API_KEY: 're_test_key',
        RESEND_BASE_URL: `http://127.0.0.1:${port}`,
      }),
    );
    await sender.send(MESSAGE);

    expect(requests).toHaveLength(1);
    expect(requests[0]?.path).toBe('/emails');
    expect(requests[0]?.auth).toBe('Bearer re_test_key');
    expect(requests[0]?.body).toMatchObject({
      from: 'River <river@river.test>',
      to: ['someone@river.test'],
      subject: MESSAGE.subject,
    });
  });

  it('Resend 回傳錯誤時 send 會失敗', async () => {
    const api = createServer((_req, res) => {
      res.writeHead(422, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ name: 'validation_error', message: 'bad from' }));
    });
    await new Promise<void>((resolve) => api.listen(0, '127.0.0.1', resolve));
    cleanups.push(() => new Promise((resolve) => api.close(() => resolve())));
    const { port } = api.address() as AddressInfo;

    const sender = createEmailSender(
      emailEnvSchema.parse({
        EMAIL_TRANSPORT: 'resend',
        EMAIL_FROM: 'River <river@river.test>',
        RESEND_API_KEY: 're_test_key',
        RESEND_BASE_URL: `http://127.0.0.1:${port}`,
      }),
    );

    await expect(sender.send(MESSAGE)).rejects.toThrow(/bad from/);
  });

  it('EMAIL_TRANSPORT=resend 時必須設定 RESEND_API_KEY', () => {
    expect(() =>
      emailEnvSchema.parse({ EMAIL_TRANSPORT: 'resend', EMAIL_FROM: 'river@river.test' }),
    ).toThrow();
  });
});
