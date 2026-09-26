import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import { cleanupOpenApiDoc } from 'nestjs-zod';
import { type AppDeps, AppModule } from './app.module.js';
import { SERVICE_ACCOUNT_AUTH } from './service-account/require-service-account.js';
import { ExternalApiModule } from './service-account/service-account.module.js';

export async function createApp(deps: AppDeps): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule.register(deps), {
    // Better Auth 需要讀取原始 request body；AuthModule 會替其他路由補回 body parser。
    bodyParser: false,
    bufferLogs: true,
  });
  app.useLogger(app.get(Logger));
  app.setGlobalPrefix('api');

  // OpenAPI 文件只涵蓋外部 API，給外部系統的開發者整合用，不需要登入；
  // UI API 的合約是 packages/contracts，不公開成文件。
  const openApi = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('River External API')
      .setDescription(
        '外部系統以 Service Account 的 API key 發起 Request、查詢自己發起的 Request 的狀態。' +
          '每個請求都要帶 `Authorization: Bearer <api key>`；API key 由 Administrator 在 River 後台發放與輪替。',
      )
      .setVersion('1.0.0')
      .addBearerAuth({ type: 'http', scheme: 'bearer' }, SERVICE_ACCOUNT_AUTH)
      .build(),
    { include: [ExternalApiModule] },
  );
  SwaggerModule.setup('api/external/docs', app, cleanupOpenApiDoc(openApi));

  return app;
}
