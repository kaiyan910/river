import {
  applyDecorators,
  type CanActivate,
  createParamDecorator,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { AllowAnonymous } from '@thallesp/nestjs-better-auth';
import {
  type AuthenticatedServiceAccount,
  ServiceAccountsService,
} from './service-accounts.service.js';

/** OpenAPI 文件裡 Bearer 驗證方式的名稱。 */
export const SERVICE_ACCOUNT_AUTH = 'serviceAccountKey';

interface GuardedRequest {
  headers: Record<string, string | string[] | undefined>;
  serviceAccount?: AuthenticatedServiceAccount;
}

/**
 * 外部 API：只接受 `Authorization: Bearer <api key>`，與 session cookie 完全分開。
 * 跳過 Better Auth 的全域 AuthGuard（它只認 session），改由 ServiceAccountGuard 驗證 key；
 * 帶著 session cookie 但沒有 key 的請求一樣回 401。
 */
export function RequireServiceAccount() {
  return applyDecorators(
    AllowAnonymous(),
    UseGuards(ServiceAccountGuard),
    ApiBearerAuth(SERVICE_ACCOUNT_AUTH),
    ApiUnauthorizedResponse({ description: '沒有帶 API key，或 API key 無效（例如已經輪替）' }),
  );
}

@Injectable()
export class ServiceAccountGuard implements CanActivate {
  constructor(private readonly serviceAccounts: ServiceAccountsService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<GuardedRequest>();
    const header = request.headers.authorization;
    const match = typeof header === 'string' ? /^Bearer\s+(\S+)$/i.exec(header) : null;
    if (!match?.[1]) throw new UnauthorizedException('需要 Service Account 的 API key');
    const account = await this.serviceAccounts.authenticate(match[1]);
    if (!account) throw new UnauthorizedException('API key 無效');
    request.serviceAccount = account;
    return true;
  }
}

/** 目前呼叫者的 Service Account；只能用在掛了 `@RequireServiceAccount` 的 handler。 */
export const CurrentServiceAccount = createParamDecorator(
  (_: unknown, context: ExecutionContext): AuthenticatedServiceAccount => {
    const account = context.switchToHttp().getRequest<GuardedRequest>().serviceAccount;
    if (!account) throw new Error('CurrentServiceAccount 必須搭配 @RequireServiceAccount 使用');
    return account;
  },
);
