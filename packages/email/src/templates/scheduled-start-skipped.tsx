// worker 以 tsx 從原始碼執行時不套用這個 package 的 tsconfig，所以在檔案裡指定 JSX runtime。
/** @jsxRuntime automatic */
/** @jsxImportSource react */
import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Text,
} from '@react-email/components';
import { render, toPlainText } from '@react-email/render';
import type { EmailMessage } from '../email-sender.js';

/**
 * 排程時間到了卻沒有發起 Request（例如指定的發起人已停用），寄給 Administrator。
 * reason 是給人看的原因；url 開到 Designer 的 Process，可以在那裡修改排程。
 */
export interface ScheduledStartSkippedNotificationProps {
  to: string;
  url: string;
  processName: string;
  reason: string;
}

function ScheduledStartSkippedEmail({
  url,
  processName,
  reason,
}: Omit<ScheduledStartSkippedNotificationProps, 'to'>) {
  return (
    <Html lang="zh-Hant-TW">
      <Head />
      <Preview>{`「${processName}」的排程發起已跳過`}</Preview>
      <Body style={{ backgroundColor: '#f6f8fa', fontFamily: 'system-ui, sans-serif' }}>
        <Container style={{ backgroundColor: '#ffffff', padding: '32px', borderRadius: '8px' }}>
          <Heading as="h1" style={{ fontSize: '20px' }}>
            排程發起已跳過
          </Heading>
          <Text>「{processName}」的排程時間到了，但這一次沒有發起 Request：</Text>
          <Text style={{ margin: '4px 0' }}>・{reason}</Text>
          <Text>請聯絡 Designer 修改排程設定；下一次排程時間仍會照常嘗試發起。</Text>
          <Button
            href={url}
            style={{
              backgroundColor: '#1f6fae',
              color: '#ffffff',
              padding: '10px 18px',
              borderRadius: '8px',
            }}
          >
            查看 Process
          </Button>
          <Text style={{ color: '#6b7280', fontSize: '13px' }}>
            按鈕無法使用時，請把這個網址貼到瀏覽器：{url}
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

export async function renderScheduledStartSkippedNotification({
  to,
  ...props
}: ScheduledStartSkippedNotificationProps): Promise<EmailMessage> {
  const subject = `排程發起已跳過：${props.processName}`;
  const html = await render(<ScheduledStartSkippedEmail {...props} />);
  return { to, subject, html, text: toPlainText(html) };
}
