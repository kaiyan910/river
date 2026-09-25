import {
  applyDecorators,
  type CanActivate,
  createParamDecorator,
  type ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  SetMetadata,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiForbiddenResponse } from '@nestjs/swagger';
import type { Permission } from '@river/auth';
import type { Database } from '@river/db';
import type { UserSession } from '@thallesp/nestjs-better-auth';
import { DATABASE } from '../tokens.js';
import { type ActiveParticipant, findActiveParticipant } from './active-participant.js';

const REQUIRED_PERMISSIONS = Symbol('REQUIRED_PERMISSIONS');

interface GuardedRequest {
  session?: UserSession | null;
  participant?: ActiveParticipant;
}

/**
 * 只有持有其中任一個 Permission 的 Participant 才能呼叫。
 * 以方法層級的 guard 實作，所以一定在 Better Auth 的全域 AuthGuard 之後執行，可以讀到 session。
 */
export function RequirePermission(...permissions: [Permission, ...Permission[]]) {
  return applyDecorators(
    SetMetadata(REQUIRED_PERMISSIONS, permissions),
    UseGuards(PermissionGuard),
    ApiForbiddenResponse({ description: `需要 Permission：${permissions.join(' 或 ')}` }),
  );
}

/** 任何有效（未停用）的 Participant 都能呼叫；handler 可以用 `@CurrentParticipant()` 取得呼叫者。 */
export function RequireParticipant() {
  return applyDecorators(SetMetadata(REQUIRED_PERMISSIONS, []), UseGuards(PermissionGuard));
}

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(DATABASE) private readonly db: Database,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<Permission[] | undefined>(
      REQUIRED_PERMISSIONS,
      [context.getHandler(), context.getClass()],
    );
    const request = context.switchToHttp().getRequest<GuardedRequest>();
    const userId = request.session?.user.id;
    if (!userId) throw new UnauthorizedException();

    const participant = await findActiveParticipant(this.db, userId);
    if (!participant) throw new ForbiddenException('這個帳號不是有效的 Participant');
    if (required?.length && !required.some((p) => participant.permissions.includes(p))) {
      throw new ForbiddenException(`需要 Permission：${required.join(' 或 ')}`);
    }
    request.participant = participant;
    return true;
  }
}

/** 目前呼叫者的 Participant；只能用在掛了 `@RequirePermission` 或 `@RequireParticipant` 的 handler。 */
export const CurrentParticipant = createParamDecorator(
  (_: unknown, context: ExecutionContext): ActiveParticipant => {
    const participant = context.switchToHttp().getRequest<GuardedRequest>().participant;
    if (!participant)
      throw new Error('CurrentParticipant 必須搭配 @RequirePermission 或 @RequireParticipant 使用');
    return participant;
  },
);
