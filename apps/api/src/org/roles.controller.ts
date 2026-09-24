import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse } from '@nestjs/swagger';
import { roleListSchema, roleNameSchema, roleSchema } from '@river/contracts';
import { createZodDto } from 'nestjs-zod';
import { RequirePermission } from '../auth/require-permission.js';
import { RolesService } from './roles.service.js';

class RoleDto extends createZodDto(roleSchema) {}
class RoleListDto extends createZodDto(roleListSchema) {}
class RoleNameDto extends createZodDto(roleNameSchema) {}

const Id = (name: string) => Param(name, new ParseUUIDPipe());

@Controller('roles')
@RequirePermission('role.manage')
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @Get()
  @ApiOkResponse({ type: RoleListDto })
  list(): Promise<RoleDto[]> {
    return this.roles.list();
  }

  @Post()
  @ApiCreatedResponse({ type: RoleDto })
  create(@Body() body: RoleNameDto): Promise<RoleDto> {
    return this.roles.create(body.name);
  }

  @Patch(':id')
  @ApiOkResponse({ type: RoleDto })
  rename(@Id('id') id: string, @Body() body: RoleNameDto): Promise<RoleDto> {
    return this.roles.rename(id, body.name);
  }

  @Put(':id/members/:participantId')
  @HttpCode(204)
  addMember(@Id('id') id: string, @Id('participantId') participantId: string): Promise<void> {
    return this.roles.addMember(id, participantId);
  }

  @Delete(':id/members/:participantId')
  @HttpCode(204)
  removeMember(@Id('id') id: string, @Id('participantId') participantId: string): Promise<void> {
    return this.roles.removeMember(id, participantId);
  }
}
