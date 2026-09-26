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
 * 與 Request 有關的通知：
 * - taskCreated：有新的 Task，寄給處理人（指派給 Role 時寄給每一位成員）
 * - returned：Request 被 Return，寄給發起人
 * - completed：Request 完成，寄給發起人
 * - custom：流程裡的 Email 節點，主旨與內文由 Designer 的範本產生（已經代入變數）
 */
export type RequestNotification =
  | { kind: 'taskCreated' | 'returned' | 'completed' }
  | { kind: 'custom'; subject: string; message: string };

/**
 * 信件只能帶這些非敏感的欄位，一律不含 Form 資料：信件會經過外部的寄信服務。
 * url 直接開到對應的 Task 或 Request；還沒登入時先登入，登入後再回到這個頁面。
 */
export interface RequestNotificationProps {
  to: string;
  requestTitle: string;
  processName: string;
  url: string;
  notification: RequestNotification;
}

interface Content {
  subject: string;
  preview: string;
  heading: string;
  paragraphs: string[];
  action: string;
}

function contentOf({ requestTitle, processName, notification }: RequestNotificationProps): Content {
  const request = `「${processName}」的申請「${requestTitle}」`;
  switch (notification.kind) {
    case 'taskCreated':
      return {
        subject: `新的待辦：${requestTitle}`,
        preview: `${request}需要你處理`,
        heading: '你有一個新的待辦',
        paragraphs: [`${request}需要你處理。`],
        action: '前往處理',
      };
    case 'returned':
      return {
        subject: `申請被退回：${requestTitle}`,
        preview: `${request}被退回，請修改後重新送出`,
        heading: '你的申請被退回了',
        paragraphs: [`你的${request}被退回，請修改後重新送出。`],
        action: '查看申請',
      };
    case 'completed':
      return {
        subject: `申請已完成：${requestTitle}`,
        preview: `${request}已完成`,
        heading: '你的申請已完成',
        paragraphs: [`你的${request}已經完成所有審批。`],
        action: '查看申請',
      };
    case 'custom':
      return {
        subject: notification.subject,
        preview: notification.subject,
        heading: notification.subject,
        paragraphs: notification.message.split(/\n+/).filter((p) => p.trim()),
        action: '查看申請',
      };
  }
}

function RequestNotificationEmail({ url, content }: { url: string; content: Content }) {
  return (
    <Html lang="zh-Hant-TW">
      <Head />
      <Preview>{content.preview}</Preview>
      <Body style={{ backgroundColor: '#f6f8fa', fontFamily: 'system-ui, sans-serif' }}>
        <Container style={{ backgroundColor: '#ffffff', padding: '32px', borderRadius: '8px' }}>
          <Heading as="h1" style={{ fontSize: '20px' }}>
            {content.heading}
          </Heading>
          {content.paragraphs.map((p, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: 信件只渲染一次，段落不會重新排序
            <Text key={i}>{p}</Text>
          ))}
          <Button
            href={url}
            style={{
              backgroundColor: '#1f6fae',
              color: '#ffffff',
              padding: '10px 18px',
              borderRadius: '8px',
            }}
          >
            {content.action}
          </Button>
          <Text style={{ color: '#6b7280', fontSize: '13px' }}>
            按鈕無法使用時，請把這個網址貼到瀏覽器：{url}
          </Text>
          <Text style={{ color: '#6b7280', fontSize: '13px' }}>
            為了保護資料，信件不會包含表單內容，請登入 River 查看。
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

export async function renderRequestNotification(
  props: RequestNotificationProps,
): Promise<EmailMessage> {
  const content = contentOf(props);
  const html = await render(<RequestNotificationEmail url={props.url} content={content} />);
  return { to: props.to, subject: content.subject, html, text: toPlainText(html) };
}
