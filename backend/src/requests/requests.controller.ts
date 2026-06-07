import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { RequestsService } from './requests.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CreateRequestDto } from './dto/create-request.dto';
import { UserRole, RequestStatus } from '@prisma/client';

@ApiTags('Requests')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('requests')
export class RequestsController {
  constructor(private readonly requestsService: RequestsService) {}

  @Get()
  findAll(
    @Query('status') status?: RequestStatus,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @CurrentUser('id') requesterId?: string,
    @CurrentUser('role') role?: UserRole,
  ) {
    const isRequester = role === UserRole.REQUESTER;
    return this.requestsService.findAll({
      status,
      page,
      limit,
      requesterId: isRequester ? requesterId : undefined,
    });
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.requestsService.findOne(id);
  }

  @Post()
  create(
    @Body() body: CreateRequestDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.requestsService.create(body, userId);
  }

  @Patch(':id/submit')
  submit(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return this.requestsService.submit(id, userId);
  }

  @Patch(':id/cancel')
  cancel(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return this.requestsService.cancel(id, userId);
  }

  @Patch(':id/approve')
  @UseGuards(RolesGuard)
  @Roles(UserRole.SYSTEM_ADMIN, UserRole.WAREHOUSE_MANAGER, UserRole.DEPT_APPROVER)
  approve(
    @Param('id') id: string,
    @Body() body: { approved: boolean; rejectReason?: string },
    @CurrentUser('id') userId: string,
  ) {
    return this.requestsService.approve(id, userId, body.approved, body.rejectReason);
  }
}
