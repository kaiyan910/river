import {
  GetObjectCommand,
  HeadObjectCommand,
  NotFound,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { z } from 'zod';

/**
 * 附件的 object storage。API 只發出 presigned URL，檔案由瀏覽器直接上傳、下載，不經過 API 轉送；
 * API 唯一會直接呼叫的是確認 object 已經上傳（大小）。
 */
export interface AttachmentStorage {
  /** 上傳 URL：簽入 Content-Type 與 Content-Length，瀏覽器上傳的檔案必須相符。 */
  presignUpload(
    key: string,
    file: { contentType: string; size: number },
  ): Promise<PresignedRequest & { headers: Record<string, string> }>;
  /** 下載 URL：回應帶 Content-Disposition: attachment 與原本的檔名。 */
  presignDownload(
    key: string,
    file: { fileName: string; contentType: string },
  ): Promise<PresignedRequest>;
  /** object 的大小（bytes）；還沒上傳時為 null。 */
  sizeOf(key: string): Promise<number | null>;
}

export interface PresignedRequest {
  url: string;
  expiresAt: Date;
}

export const storageEnvSchema = z.object({
  /** api 連到 object storage 的網址，例如 http://localhost:3900（Garage 的 S3 API）。 */
  S3_ENDPOINT: z.url(),
  /** 瀏覽器連到 object storage 的網址（presigned URL 用）；沒有設定時同 S3_ENDPOINT。 */
  S3_PUBLIC_ENDPOINT: z.url().optional(),
  S3_REGION: z.string().default('garage'),
  S3_BUCKET: z.string().min(1).default('river-attachments'),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
});

export interface S3Config {
  endpoint: string;
  publicEndpoint?: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export function s3ConfigFromEnv(env: z.infer<typeof storageEnvSchema>): S3Config {
  return {
    endpoint: env.S3_ENDPOINT,
    publicEndpoint: env.S3_PUBLIC_ENDPOINT,
    region: env.S3_REGION,
    bucket: env.S3_BUCKET,
    accessKeyId: env.S3_ACCESS_KEY_ID,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY,
  };
}

/** 上傳 URL 的有效時間：足夠上傳上限大小的檔案，又不會長到被拿去重複使用。 */
const UPLOAD_TTL_SECONDS = 15 * 60;
/** 下載 URL 只在點下去的當下使用，所以很短。 */
const DOWNLOAD_TTL_SECONDS = 5 * 60;

/** S3 相容的實作（正式環境與測試都連 Garage）。path-style，因為 Garage 預設不開 virtual-hosted bucket。 */
export class S3AttachmentStorage implements AttachmentStorage {
  private readonly client: S3Client;
  /** presigned URL 只在本機簽章，不會連線；用瀏覽器看得到的網址簽。 */
  private readonly signer: S3Client;

  constructor(private readonly config: S3Config) {
    const options = (endpoint: string) =>
      new S3Client({
        endpoint,
        region: config.region,
        forcePathStyle: true,
        credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
        // Garage 不支援新版 SDK 預設加上的 checksum。
        requestChecksumCalculation: 'WHEN_REQUIRED',
        responseChecksumValidation: 'WHEN_REQUIRED',
      });
    this.client = options(config.endpoint);
    this.signer = options(config.publicEndpoint ?? config.endpoint);
  }

  async presignUpload(key: string, file: { contentType: string; size: number }) {
    const command = new PutObjectCommand({
      Bucket: this.config.bucket,
      Key: key,
      ContentType: file.contentType,
      ContentLength: file.size,
    });
    const url = await getSignedUrl(this.signer, command, {
      expiresIn: UPLOAD_TTL_SECONDS,
      signableHeaders: new Set(['content-type', 'content-length']),
    });
    return {
      url,
      headers: { 'content-type': file.contentType },
      expiresAt: expiresIn(UPLOAD_TTL_SECONDS),
    };
  }

  async presignDownload(key: string, file: { fileName: string; contentType: string }) {
    const command = new GetObjectCommand({
      Bucket: this.config.bucket,
      Key: key,
      ResponseContentDisposition: contentDisposition(file.fileName),
      ResponseContentType: file.contentType,
    });
    const url = await getSignedUrl(this.signer, command, { expiresIn: DOWNLOAD_TTL_SECONDS });
    return { url, expiresAt: expiresIn(DOWNLOAD_TTL_SECONDS) };
  }

  async sizeOf(key: string): Promise<number | null> {
    try {
      const head = await this.client.send(
        new HeadObjectCommand({ Bucket: this.config.bucket, Key: key }),
      );
      return head.ContentLength ?? null;
    } catch (error) {
      if (error instanceof NotFound || (error as { name?: string }).name === 'NotFound')
        return null;
      throw error;
    }
  }
}

const expiresIn = (seconds: number) => new Date(Date.now() + seconds * 1000);

/** 下載時的檔名：ASCII 後備名稱加上 RFC 5987 的 UTF-8 檔名，中文檔名也能正確顯示。 */
function contentDisposition(fileName: string): string {
  const fallback = fileName.replace(/[^\x20-\x7e]|["\\]/g, '_');
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}
