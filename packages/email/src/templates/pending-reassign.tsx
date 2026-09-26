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
 * 「待 Reassign」清單有新項目，寄給持有 task.reassign 的 Administrator：
 * - 停用帳號時，此人還有直接指派給他的 open Task
 * - 流程走到直接指派給已停用 Participant 的步驟
 * 信件只列出 Request 標題與 Process 名稱，不含 Form 資料；url 開到「待 Reassign」清單。
 */
export interface PendingReassignNotificationProps {
  to: string;
  url: string;
  /** 已停用的 Participant。 */
  participantName: string;
  tasks: { requestTitle: string; processName: string }[];
}

function PendingReassignEmail({
  url,
  participantName,
  tasks,
}: Omit<PendingReassignNotificationProps, 'to'>) {
  return (
    <Html lang="zh-Hant-TW">
      <Head />
      <Preview>{`${participantName} 已停用，有 ${tasks.length} 個 Task 待 Reassign`}</Preview>
      <Body style={{ backgroundColor: '#f6f8fa', fontFamily: 'system-ui, sans-serif' }}>
        <Container style={{ backgroundColor: '#ffffff', padding: '32px', borderRadius: '8px' }}>
          <Heading as="h1" style={{ fontSize: '20px' }}>
            有 Task 待 Reassign
          </Heading>
          <Text>
            {participantName} 的帳號已停用，以下直接指派給他的 Task 沒有人可以處理，請改派給其他人：
          </Text>
          {tasks.map((t, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: 信件只渲染一次，清單不會重新排序
            <Text key={i} style={{ margin: '4px 0' }}>
              ・「{t.processName}」的申請「{t.requestTitle}」
            </Text>
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
            前往待 Reassign 清單
          </Button>
          <Text style={{ color: '#6b7280', fontSize: '13px' }}>
            按鈕無法使用時，請把這個網址貼到瀏覽器：{url}
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

export async function renderPendingReassignNotification({
  to,
  ...props
}: PendingReassignNotificationProps): Promise<EmailMessage> {
  const [first] = props.tasks;
  const subject =
    props.tasks.length === 1 && first
      ? `待 Reassign：${first.requestTitle}`
      : `待 Reassign：${props.participantName} 的 ${props.tasks.length} 個 Task`;
  const html = await render(<PendingReassignEmail {...props} />);
  return { to, subject, html, text: toPlainText(html) };
}
