import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ThaiAddressService } from './thai-address.service';

/**
 * The Thai Post address book. Signing in is enough to read it: it is the
 * published national list, the same for everyone, and it is read while filling
 * in an address on almost any screen — gating it per role would only put a
 * permission error between someone and a postcode.
 */
@ApiTags('Thai address')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('thai-addresses')
export class ThaiAddressController {
  constructor(private readonly svc: ThaiAddressService) {}

  @Get('search')
  @ApiOperation({
    summary:
      'Look up by postal code or by place name (Thai or English, tambon / district / province)',
  })
  search(@Query('q') q: string | undefined, @Query('limit') limit: string | undefined) {
    return this.svc.search(q, limit ? +limit : undefined);
  }

  @Get('provinces')
  provinces() {
    return this.svc.provinces();
  }

  @Get('districts')
  districts(@Query('provinceId') provinceId?: string) {
    return this.svc.districts(provinceId);
  }

  @Get('tambons')
  tambons(@Query('districtId') districtId?: string) {
    return this.svc.tambons(districtId);
  }

  @Get(':postCode')
  @ApiOperation({ summary: 'Every tambon that uses one postal code' })
  byPostCode(@Param('postCode') postCode: string) {
    return this.svc.byPostCode(postCode);
  }
}
