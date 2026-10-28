import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AccessGuard } from '../auth/guards/access.guard';
import { Access } from '../auth/decorators/access.decorator';
import { ACCESS } from '../auth/access';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { MasterDataService, REASON_CATEGORIES } from './master-data.service';

/** Reads are open to any signed-in user (forms need the lists); writes need master-data rights. */
@ApiTags('Master Data')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AccessGuard)
@Controller('master-data')
export class MasterDataController {
  constructor(private readonly svc: MasterDataService) {}

  @Get('reason-codes')
  @ApiOperation({
    summary: 'Reason codes (active only unless includeInactive=true)',
  })
  reasonCodes(
    @Query('category') category?: string,
    @Query('includeInactive') inc?: string,
  ) {
    return this.svc.listReasonCodes(category, inc === 'true');
  }

  @Get('reason-codes/categories')
  reasonCategories() {
    return REASON_CATEGORIES;
  }

  @Post('reason-codes')
  @Access(ACCESS.masterData)
  createReasonCode(@Body() dto: any, @CurrentUser('id') userId: string) {
    return this.svc.createReasonCode(dto, userId);
  }

  @Patch('reason-codes/:id')
  @Access(ACCESS.masterData)
  updateReasonCode(
    @Param('id') id: string,
    @Body() dto: any,
    @CurrentUser('id') userId: string,
  ) {
    return this.svc.updateReasonCode(id, dto, userId);
  }

  @Get('departments')
  departments(@Query('includeInactive') inc?: string) {
    return this.svc.listDepartments(inc === 'true');
  }

  @Post('departments')
  @Access(ACCESS.masterData)
  createDepartment(@Body() dto: any, @CurrentUser('id') userId: string) {
    return this.svc.createDepartment(dto, userId);
  }

  @Patch('departments/:id')
  @Access(ACCESS.masterData)
  updateDepartment(
    @Param('id') id: string,
    @Body() dto: any,
    @CurrentUser('id') userId: string,
  ) {
    return this.svc.updateDepartment(id, dto, userId);
  }

  @Get('uoms')
  uoms(@Query('includeInactive') inc?: string) {
    return this.svc.listUoms(inc === 'true');
  }

  @Post('uoms')
  @Access(ACCESS.masterData)
  createUom(@Body() dto: any, @CurrentUser('id') userId: string) {
    return this.svc.createUom(dto, userId);
  }

  @Patch('uoms/:id')
  @Access(ACCESS.masterData)
  updateUom(
    @Param('id') id: string,
    @Body() dto: any,
    @CurrentUser('id') userId: string,
  ) {
    return this.svc.updateUom(id, dto, userId);
  }
}
