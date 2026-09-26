import {
  ATTACHMENT_MAX_FILES,
  type AttachmentRef,
  acceptsFile,
  attachmentRefSchema,
  type FormField,
  maxAttachmentBytes,
} from '@river/forms';
import { Download, ImageIcon, Paperclip, Upload, X } from 'lucide-react';
import { createContext, useContext, useEffect, useId, useRef, useState } from 'react';
import { toast } from '@/components/toast';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api';
import { attachmentUrl, downloadAttachment, uploadAttachment } from '@/lib/attachments';
import { cn } from '@/lib/utils';

/** 上傳與下載的實作；表單設計器的即時預覽換成不連線的版本。 */
export interface AttachmentTransport {
  upload: (file: File) => Promise<AttachmentRef>;
  /** 沒有時（預覽）不顯示下載。 */
  download?: (id: string) => Promise<void>;
  /** 圖片預覽用的 URL；沒有時（預覽）點圖片不會開啟預覽。 */
  url?: (id: string) => Promise<string>;
}

const AttachmentTransportContext = createContext<AttachmentTransport>({
  upload: uploadAttachment,
  download: downloadAttachment,
  url: attachmentUrl,
});
export const AttachmentTransportProvider = AttachmentTransportContext.Provider;

/** 表單設計器的即時預覽：檔案不會真的上傳，只產生中繼資料讓驗證照常運作。 */
export const previewTransport: AttachmentTransport = {
  upload: async (file) => ({
    id: crypto.randomUUID(),
    name: file.name,
    size: file.size,
    contentType: file.type || 'application/octet-stream',
  }),
};

/** 存下來的值轉回附件清單；不是附件的內容略過。 */
export function attachmentsFrom(value: unknown): AttachmentRef[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((v) => {
    const parsed = attachmentRefSchema.safeParse(v);
    return parsed.success ? [parsed.data] : [];
  });
}

/** 瀏覽器能直接顯示的圖片，點擊時開啟預覽而不是下載。 */
export function isPreviewableImage(a: AttachmentRef): boolean {
  return /^image\/(png|jpe?g|gif|webp|avif|bmp|svg\+xml)$/i.test(a.contentType);
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** 附件欄位的說明：允許的類型、大小與數量。 */
export function describeAttachmentRules(f: FormField): string {
  const r = f.rules;
  return [
    r.accept?.length ? r.accept.join('、') : '不限類型',
    `每個最多 ${maxAttachmentBytes(f) / 1024 / 1024} MB`,
    `最多 ${r.maxFiles ?? ATTACHMENT_MAX_FILES} 個`,
  ].join(' · ');
}

/**
 * 附件欄位的輸入：選檔後先在瀏覽器檢查類型、大小與數量，再逐一上傳；上傳完成的檔案才放進欄位值。
 * 送出表單時 API 會確認檔案已上傳，並依同一份設定再檢查一次。
 */
export function AttachmentInput({
  id,
  field,
  value,
  onChange,
  onBlur,
  invalid,
  disabled,
}: {
  id: string;
  field: FormField;
  value: AttachmentRef[];
  onChange: (value: AttachmentRef[]) => void;
  onBlur?: () => void;
  invalid?: boolean;
  disabled?: boolean;
}) {
  const transport = useContext(AttachmentTransportContext);
  const input = useRef<HTMLInputElement>(null);
  const hintId = useId();
  const [uploading, setUploading] = useState<string[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const r = field.rules;
  const maxFiles = r.maxFiles ?? ATTACHMENT_MAX_FILES;
  const maxBytes = maxAttachmentBytes(field);

  async function add(files: File[]) {
    setProblem(null);
    if (value.length + files.length > maxFiles) return setProblem(`最多 ${maxFiles} 個檔案`);
    for (const file of files) {
      if (!acceptsFile(r.accept, file.name))
        return setProblem(`「${file.name}」的檔案類型不允許，只接受 ${r.accept?.join('、')}`);
      if (file.size === 0) return setProblem(`「${file.name}」是空的檔案`);
      if (file.size > maxBytes)
        return setProblem(`「${file.name}」超過 ${maxBytes / 1024 / 1024} MB`);
    }
    setUploading(files.map((f) => f.name));
    const uploaded: AttachmentRef[] = [];
    try {
      for (const file of files) uploaded.push(await transport.upload(file));
    } catch (error) {
      setProblem(error instanceof Error ? error.message : '上傳失敗，請再試一次。');
    } finally {
      setUploading([]);
      if (uploaded.length) onChange([...value, ...uploaded]);
      onBlur?.();
    }
  }

  const busy = uploading.length > 0;
  return (
    <div className="grid gap-1.5">
      {value.length > 0 && (
        <AttachmentList
          files={value}
          onRemove={disabled ? undefined : (a) => onChange(value.filter((x) => x.id !== a.id))}
        />
      )}
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={input}
          id={id}
          type="file"
          className="sr-only"
          multiple={maxFiles > 1}
          accept={r.accept?.join(',')}
          disabled={disabled || busy || value.length >= maxFiles}
          aria-invalid={invalid || undefined}
          aria-describedby={hintId}
          onChange={(e) => {
            const files = [...(e.target.files ?? [])];
            e.target.value = '';
            if (files.length) void add(files);
          }}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled || busy || value.length >= maxFiles}
          onClick={() => input.current?.click()}
          className={cn(invalid && 'border-destructive')}
        >
          <Upload className="size-4" />
          {busy ? `上傳中：${uploading.join('、')}` : '選擇檔案'}
        </Button>
        <span id={hintId} className="text-[0.82em] text-muted-foreground">
          {describeAttachmentRules(field)}
        </span>
      </div>
      {problem && <p className="text-[0.85em] text-destructive">{problem}</p>}
    </div>
  );
}

/** 附件清單：可以下載，圖片點擊後先預覽；編輯時可以移除。 */
export function AttachmentList({
  files,
  onRemove,
}: {
  files: AttachmentRef[];
  onRemove?: (file: AttachmentRef) => void;
}) {
  const { download, url } = useContext(AttachmentTransportContext);
  const [previewing, setPreviewing] = useState<AttachmentRef | null>(null);

  function save(a: AttachmentRef) {
    download?.(a.id).catch((error) =>
      toast(error instanceof ApiError ? error.message : '下載失敗，請稍後再試。', 'error'),
    );
  }

  return (
    <>
      <ul className="grid gap-1">
        {files.map((a) => (
          <li
            key={a.id}
            className="flex min-w-0 items-center gap-2 rounded-lg border bg-card px-2.5 py-1.5"
          >
            {isPreviewableImage(a) ? (
              <ImageIcon className="size-4 shrink-0 text-muted-foreground" />
            ) : (
              <Paperclip className="size-4 shrink-0 text-muted-foreground" />
            )}
            {download ? (
              <button
                type="button"
                className="min-w-0 cursor-pointer truncate text-left underline-offset-2 hover:underline"
                onClick={() => (url && isPreviewableImage(a) ? setPreviewing(a) : save(a))}
              >
                {a.name}
              </button>
            ) : (
              <span className="min-w-0 truncate">{a.name}</span>
            )}
            <span className="shrink-0 font-mono text-[0.82em] text-muted-foreground">
              {formatSize(a.size)}
            </span>
            <span className="flex-1" />
            {download && !onRemove && (
              <Download className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            )}
            {onRemove && (
              <button
                type="button"
                aria-label={`移除 ${a.name}`}
                className="cursor-pointer rounded p-0.5 text-muted-foreground hover:text-destructive"
                onClick={() => onRemove(a)}
              >
                <X className="size-4" />
              </button>
            )}
          </li>
        ))}
      </ul>
      {previewing && url && (
        <ImagePreview
          file={previewing}
          url={url}
          onDownload={download && (() => save(previewing))}
          onClose={() => setPreviewing(null)}
        />
      )}
    </>
  );
}

/** 圖片附件的預覽：開啟時才取得短效 URL；Esc 或點背景關閉。 */
function ImagePreview({
  file,
  url,
  onDownload,
  onClose,
}: {
  file: AttachmentRef;
  url: (id: string) => Promise<string>;
  onDownload?: () => void;
  onClose: () => void;
}) {
  const titleId = useId();
  const [src, setSrc] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    url(file.id).then(
      (u) => active && setSrc(u),
      (error) =>
        active &&
        setProblem(error instanceof ApiError ? error.message : '無法載入圖片，請稍後再試。'),
    );
    return () => {
      active = false;
    };
  }, [file.id, url]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: 點背景關閉是額外的捷徑，鍵盤可用 Esc 或關閉按鈕
    // biome-ignore lint/a11y/useKeyWithClickEvents: 同上
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal
        aria-labelledby={titleId}
        className="grid max-h-[92vh] w-full max-w-4xl grid-rows-[auto_minmax(0,1fr)] gap-3 rounded-xl border bg-card p-4 shadow-xl"
      >
        <div className="flex min-w-0 items-center gap-2">
          <h2 id={titleId} className="min-w-0 truncate font-semibold">
            {file.name}
          </h2>
          <span className="shrink-0 font-mono text-[0.82em] text-muted-foreground">
            {formatSize(file.size)}
          </span>
          <span className="flex-1" />
          {onDownload && (
            <Button type="button" variant="outline" size="sm" onClick={onDownload}>
              <Download className="size-4" />
              下載
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label="關閉預覽"
            onClick={onClose}
            autoFocus
          >
            <X className="size-4" />
          </Button>
        </div>
        <div className="grid min-h-40 place-items-center overflow-auto rounded-lg bg-muted">
          {problem ? (
            <p className="p-6 text-destructive">{problem}</p>
          ) : src ? (
            <img
              src={src}
              alt={file.name}
              className="max-h-[80vh] max-w-full object-contain"
              onError={() => setProblem('這張圖片無法在瀏覽器顯示，請下載後查看。')}
            />
          ) : (
            <p className="p-6 text-muted-foreground">載入圖片…</p>
          )}
        </div>
      </div>
    </div>
  );
}
