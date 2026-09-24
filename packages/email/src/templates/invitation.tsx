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

export interface InvitationEmailProps {
  to: string;
  name: string;
  inviterName: string;
  /** 設定密碼頁的完整網址。 */
  url: string;
  expiresInHours: number;
}

function InvitationEmail({ name, inviterName, url, expiresInHours }: InvitationEmailProps) {
  return (
    <Html lang="zh-Hant-TW">
      <Head />
      <Preview>{inviterName} 邀請你加入 River</Preview>
      <Body style={{ backgroundColor: '#f6f8fa', fontFamily: 'system-ui, sans-serif' }}>
        <Container style={{ backgroundColor: '#ffffff', padding: '32px', borderRadius: '8px' }}>
          <Heading as="h1" style={{ fontSize: '20px' }}>
            歡迎加入 River
          </Heading>
          <Text>{name} 你好，</Text>
          <Text>
            {inviterName} 邀請你加入公司的 River 流程平台。請在 {expiresInHours}{' '}
            小時內點下方按鈕設定密碼，之後就能用這個 email 登入。
          </Text>
          <Button
            href={url}
            style={{
              backgroundColor: '#1f6fae',
              color: '#ffffff',
              padding: '10px 18px',
              borderRadius: '8px',
            }}
          >
            設定密碼
          </Button>
          <Text style={{ color: '#6b7280', fontSize: '13px' }}>
            按鈕無法使用時，請把這個網址貼到瀏覽器：{url}
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

export async function renderInvitationEmail(props: InvitationEmailProps): Promise<EmailMessage> {
  const html = await render(<InvitationEmail {...props} />);
  return { to: props.to, subject: '你已受邀加入 River', html, text: toPlainText(html) };
}
