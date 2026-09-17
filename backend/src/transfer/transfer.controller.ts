import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { TransferService } from './transfer.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AccessGuard } from '../auth/guards/access.guard';
import { Access } from '../auth/decorators/access.decorator';
import { ACCESS } from '../auth/access';
import { LocationDto } from '../common/location.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CreateTransferDto } from './dto/create-transfer.dto';

@ApiTags('Stock Transfer')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('transfer')
export class TransferController {
  constructor(private readonly service: TransferService) {}

  @Get()
  findAll(@Query('status') status?: string) {
    return this.service.findAll(status);
  }

  @Post()
  @UseGuards(AccessGuard)
  @Access(ACCESS.transfer)
  create(@Body() dto: CreateTransferDto, @CurrentUser('id') userId: string) {
    return this.service.create(dto, userId);
  }

  @Patch(':id/complete')
  @UseGuards(AccessGuard)
  @Access(ACCESS.transfer)
  complete(
    @Param('id') id: string,
    @Body() dest: LocationDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.service.complete(id, dest, userId);
  }
}
