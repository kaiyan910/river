/**
 * 設定附件 bucket 的 CORS：瀏覽器用 presigned URL 直接上傳、下載，object storage 要允許 River 的網址。
 * bucket 與 access key 要先用 garage CLI 建立（見 deploy/README.md）。重複執行沒有影響。
 *
 *   bun run setup:storage
 */
import { PutBucketCorsCommand, S3Client } from '@aws-sdk/client-s3';
import { s3ConfigFromEnv, storageEnvSchema } from '../attachment/attachment-storage.js';
import { apiEnvSchema } from '../config.js';

const env = apiEnvSchema
  .pick({ BETTER_AUTH_URL: true, BETTER_AUTH_TRUSTED_ORIGINS: true })
  .parse(process.env);
const config = s3ConfigFromEnv(storageEnvSchema.parse(process.env));
const origins = [
  ...new Set([new URL(env.BETTER_AUTH_URL).origin, ...env.BETTER_AUTH_TRUSTED_ORIGINS]),
];

const client = new S3Client({
  endpoint: config.endpoint,
  region: config.region,
  forcePathStyle: true,
  credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
});
await client.send(
  new PutBucketCorsCommand({
    Bucket: config.bucket,
    CORSConfiguration: {
      CORSRules: [
        {
          AllowedOrigins: origins,
          AllowedMethods: ['PUT', 'GET'],
          AllowedHeaders: ['content-type'],
          ExposeHeaders: ['etag'],
          MaxAgeSeconds: 3600,
        },
      ],
    },
  }),
);
console.log(`已設定 ${config.bucket} 的 CORS：${origins.join('、')}`);
