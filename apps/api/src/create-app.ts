import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import { cleanupOpenApiDoc } from 'nestjs-zod';
import { type AppDeps, AppModule } from './app.module.js';

export async function createApp(deps: AppDeps): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule.register(deps), {
    // Better Auth 需要讀取原始 request body；AuthModule 會替其他路由補回 body parser。
    bodyParser: false,
    bufferLogs: true,
  });
  app.useLogger(app.get(Logger));
  app.setGlobalPrefix('api');

  const openApi = SwaggerModule.createDocument(
    app,
    new DocumentBuilder().setTitle('River API').setVersion('0.0.0').build(),
  );
  SwaggerModule.setup('api/docs', app, cleanupOpenApiDoc(openApi));

  return app;
}
