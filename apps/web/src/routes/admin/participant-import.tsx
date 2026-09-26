import type { ImportParticipantsResult } from '@river/contracts';
import { AlertTriangle, CheckCircle2, Download, FileUp, RotateCcw, Upload } from 'lucide-react';
import { type ChangeEvent, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useImportParticipants } from '@/lib/org';

/** 範本：第一行是標題列；Manager 可以是檔案中的另一行（順序不限），也可以是現有的 Participant。 */
const TEMPLATE = [
  '姓名,email,Manager 的 email',
  '王大明,daming.wang@example.com,',
  '陳小華,xiaohua.chen@example.com,daming.wang@example.com',
].join('\r\n');

const TEMPLATE_HREF = `data:text/csv;charset=utf-8,${encodeURIComponent(`﻿${TEMPLATE}`)}`;

/** CSV 匯入：選擇檔案 → 匯入 → 列出成功的人與失敗的行（行號與原因）。 */
export function ImportParticipants({ onOpen }: { onOpen: (id: string) => void }) {
  const importCsv = useImportParticipants();
  const [file, setFile] = useState<{ name: string; text: string }>();

  async function pick(event: ChangeEvent<HTMLInputElement>) {
    const picked = event.target.files?.[0];
    event.target.value = '';
    if (!picked) return;
    importCsv.reset();
    setFile({ name: picked.name, text: await picked.text() });
  }

  if (importCsv.data) {
    return (
      <ImportResult
        result={importCsv.data}
        fileName={file?.name}
        onOpen={onOpen}
        onAgain={() => {
          importCsv.reset();
          setFile(undefined);
        }}
      />
    );
  }

  const dataLines = file ? file.text.split(/\r\n|\r|\n/).filter((l) => l.trim()).length - 1 : 0;

  return (
    <div className="mx-auto grid max-w-[640px] gap-4 px-6 py-8">
      <div>
        <h2 className="font-semibold text-[1.3em]">以 CSV 匯入 Participant</h2>
        <p className="text-muted-foreground">
          一次建立多位 Participant 並設定 Manager，每位成功匯入的人都會收到邀請信。
        </p>
      </div>

      <div className="grid gap-2 rounded-lg border bg-card px-4 py-3 text-[0.92em]">
        <p>
          第一行是標題列，需要 <code className="font-mono">姓名</code>、
          <code className="font-mono">email</code>、
          <code className="font-mono">Manager 的 email</code> 三個欄位（也可以用{' '}
          <code className="font-mono">name</code>、<code className="font-mono">manager_email</code>
          ）。
        </p>
        <ul className="grid list-disc gap-0.5 pl-5 text-muted-foreground">
          <li>
            Manager 可以是同一份檔案中的另一個人，與行的順序無關；也可以是現有的 Participant。
          </li>
          <li>沒有 Manager 時留空。</li>
          <li>有錯誤的行不會匯入，其他正確的行照常匯入；匯入後會列出失敗的行號與原因。</li>
        </ul>
        <pre className="overflow-x-auto rounded-md bg-muted px-3 py-2 font-mono text-[0.86em]">
          {TEMPLATE}
        </pre>
        <a
          href={TEMPLATE_HREF}
          download="river-participants.csv"
          className="inline-flex w-fit items-center gap-1 text-primary hover:underline"
        >
          <Download size={14} aria-hidden /> 下載範本
        </a>
      </div>

      <label className="flex cursor-pointer flex-col items-center gap-1.5 rounded-lg border border-dashed px-4 py-6 text-center hover:bg-muted/40">
        <FileUp size={22} aria-hidden className="text-muted-foreground" />
        {file ? (
          <>
            <span className="font-medium">{file.name}</span>
            <span className="text-[0.88em] text-muted-foreground">
              {dataLines} 行資料 · 點這裡改選其他檔案
            </span>
          </>
        ) : (
          <>
            <span className="font-medium">選擇 CSV 檔</span>
            <span className="text-[0.88em] text-muted-foreground">UTF-8 編碼，以逗號分隔</span>
          </>
        )}
        <input
          type="file"
          accept=".csv,text/csv"
          aria-label="選擇 CSV 檔"
          onChange={pick}
          className="sr-only"
        />
      </label>

      {importCsv.isError && (
        <p role="alert" className="text-[0.9em] text-destructive">
          {importCsv.error.message}
        </p>
      )}
      <div>
        <Button
          disabled={!file || importCsv.isPending}
          onClick={() => file && importCsv.mutate(file.text)}
        >
          <Upload size={14} aria-hidden /> {importCsv.isPending ? '匯入中…' : '匯入並寄出邀請信'}
        </Button>
      </div>
    </div>
  );
}

function ImportResult({
  result,
  fileName,
  onOpen,
  onAgain,
}: {
  result: ImportParticipantsResult;
  fileName?: string;
  onOpen: (id: string) => void;
  onAgain: () => void;
}) {
  const notInvited = result.imported.filter((r) => !r.invitationSent);

  return (
    <div className="mx-auto grid max-w-[720px] gap-5 px-6 py-8">
      <div>
        <h2 className="font-semibold text-[1.3em]">匯入結果</h2>
        {fileName && <p className="text-muted-foreground">{fileName}</p>}
      </div>

      <div className="flex flex-wrap gap-3">
        <div className="flex items-center gap-2 rounded-lg border px-4 py-2">
          <CheckCircle2 size={16} aria-hidden className="text-status-approved" />
          成功匯入 <span className="font-mono font-semibold">{result.imported.length}</span> 人
        </div>
        <div className="flex items-center gap-2 rounded-lg border px-4 py-2">
          <AlertTriangle
            size={16}
            aria-hidden
            className={result.failed.length ? 'text-destructive' : 'text-muted-foreground'}
          />
          失敗 <span className="font-mono font-semibold">{result.failed.length}</span> 行
        </div>
      </div>

      {result.failed.length > 0 && (
        <section aria-labelledby="import-failed-heading" className="grid gap-2">
          <h3 id="import-failed-heading" className="font-semibold text-[1.05em]">
            失敗的行
          </h3>
          <p className="text-[0.9em] text-muted-foreground">
            這些行沒有匯入。修正後可以只把這些行放進新的 CSV 再匯入一次。
          </p>
          <div className="overflow-x-auto rounded-lg border bg-card">
            <table className="w-full text-left text-[0.92em]">
              <thead className="border-b bg-muted/60 text-[0.9em] text-muted-foreground">
                <tr>
                  <th className="px-3 py-1.5 font-medium">行號</th>
                  <th className="px-3 py-1.5 font-medium">email</th>
                  <th className="px-3 py-1.5 font-medium">原因</th>
                </tr>
              </thead>
              <tbody>
                {result.failed.map((f) => (
                  <tr key={`${f.line}-${f.code}`} className="border-b last:border-b-0">
                    <td className="px-3 py-1.5 font-mono">{f.line}</td>
                    <td className="px-3 py-1.5 break-all">{f.email ?? '—'}</td>
                    <td className="px-3 py-1.5">{f.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {result.imported.length > 0 && (
        <section aria-labelledby="import-ok-heading" className="grid gap-2">
          <h3 id="import-ok-heading" className="font-semibold text-[1.05em]">
            已匯入並寄出邀請信
          </h3>
          {notInvited.length > 0 && (
            <p role="alert" className="text-[0.9em] text-destructive">
              {notInvited.map((r) => r.name).join('、')}
              的邀請信寄送失敗，帳號已建立，請到人員詳情重寄邀請信。
            </p>
          )}
          <ul className="flex flex-wrap gap-1.5">
            {result.imported.map((r) => (
              <li key={r.participantId}>
                <button
                  type="button"
                  onClick={() => onOpen(r.participantId)}
                  className="cursor-pointer rounded-full border px-2.5 py-0.5 text-[0.9em] hover:bg-accent"
                >
                  {r.name}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div>
        <Button size="sm" variant="outline" onClick={onAgain}>
          <RotateCcw size={13} aria-hidden /> 再匯入一份
        </Button>
      </div>
    </div>
  );
}
