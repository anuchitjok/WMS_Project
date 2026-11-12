import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { RequestsService } from './requests.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AccessGuard } from '../auth/guards/access.guard';
import { Access } from '../auth/decorators/access.decorator';
import { ACCESS } from '../auth/access';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CreateRequestDto } from './dto/create-request.dto';
import { ApproveRequestDto } from './dto/approve-request.dto';
import { BulkApproveDto } from './dto/bulk-approve.dto';
import { UserRole, RequestStatus } from '@prisma/client';

@ApiTags('Requests')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('requests')
export class RequestsController {
  constructor(private readonly requestsService: RequestsService) {}

  @Get('rma-cases')
  getOpenRtvCases() {
    return this.requestsService.getOpenRtvCases();
  }

  @Get('products-available')
  getProductsWithAvailableQty(@Query('brandId') brandId?: string) {
    return this.requestsService.getProductsWithAvailableQty(brandId);
  }

  @Get()
  findAll(
    @Query('status') status?: RequestStatus,
    @Query('stage') stage?: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @CurrentUser('id') requesterId?: string,
    @CurrentUser('role') role?: UserRole,
    @Query('q') q?: string,
  ) {
    const isRequester = role === UserRole.REQUESTER;
    return this.requestsService.findAll({
      status,
      stage,
      page,
      limit,
      q,
      requesterId: isRequester ? requesterId : undefined,
    });
  }

  // P4 4.4: same permission as the single approve; each id runs the single-approve
  // logic in its own transaction, results are reported per id.
  @Post('bulk-approve')
  @UseGuards(AccessGuard)
  @Access(ACCESS.requestApprove)
  bulkApprove(@Body() body: BulkApproveDto, @CurrentUser('id') userId: string) {
    return this.requestsService.bulkApprove(body.ids, userId, body.approve, body.reason);
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
  cancel(@Param('id') id: string, @CurrentUser() user: any) {
    return this.requestsService.cancel(id, user);
  }

  @Patch(':id/recover')
  @UseGuards(AccessGuard)
  @Access(ACCESS.reservationRelease)
  recover(@Param('id') id: string, @Body('reason') reason: string, @CurrentUser('id') userId: string) {
    return this.requestsService.recoverStalled(id, reason, userId);
  }

  // PR6: stock rows the approver may choose (read only, same right as approving).
  @Get(':id/pick-options')
  @UseGuards(AccessGuard)
  @Access(ACCESS.requestApprove)
  pickOptions(@Param('id') id: string, @CurrentUser() user: any) {
    return this.requestsService.pickOptions(id, user ?? null);
  }

  @Patch(':id/approve')
  @UseGuards(AccessGuard)
  @Access(ACCESS.requestApprove)
  approve(
    @Param('id') id: string,
    @Body() body: ApproveRequestDto,
    @CurrentUser() user: any,
  ) {
    return this.requestsService.approve(id, user.id, body.approved, body.rejectReason, {
      picks: body.picks,
      principal: user ?? null,
    });
  }
}
