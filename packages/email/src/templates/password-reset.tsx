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

export interface PasswordResetEmailProps {
  to: string;
  name: string;
  /** 重設密碼頁的完整網址。 */
  url: string;
  expiresInMinutes: number;
}

function PasswordResetEmail({ name, url, expiresInMinutes }: PasswordResetEmailProps) {
  return (
    <Html lang="zh-Hant-TW">
      <Head />
      <Preview>重設你的 River 密碼</Preview>
      <Body style={{ backgroundColor: '#f6f8fa', fontFamily: 'system-ui, sans-serif' }}>
        <Container style={{ backgroundColor: '#ffffff', padding: '32px', borderRadius: '8px' }}>
          <Heading as="h1" style={{ fontSize: '20px' }}>
            重設密碼
          </Heading>
          <Text>{name} 你好，</Text>
          <Text>
            我們收到重設你 River 密碼的要求。請在 {expiresInMinutes}{' '}
            分鐘內點下方按鈕設定新密碼；連結只能使用一次。
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
            設定新密碼
          </Button>
          <Text style={{ color: '#6b7280', fontSize: '13px' }}>
            按鈕無法使用時，請把這個網址貼到瀏覽器：{url}
          </Text>
          <Text style={{ color: '#6b7280', fontSize: '13px' }}>
            如果不是你本人提出的要求，可以忽略這封信，你的密碼不會改變。
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

export async function renderPasswordResetEmail(
  props: PasswordResetEmailProps,
): Promise<EmailMessage> {
  const html = await render(<PasswordResetEmail {...props} />);
  return { to: props.to, subject: 'River 重設密碼', html, text: toPlainText(html) };
}
