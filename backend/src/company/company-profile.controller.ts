import {
  Body,
  Controller,
  Delete,
  Get,
  Post,
  Put,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AccessGuard } from '../auth/guards/access.guard';
import { Access } from '../auth/decorators/access.decorator';
import { ACCESS, AccessPrincipal } from '../auth/access';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CompanyProfileService } from './company-profile.service';
import { UpdateCompanyProfileDto } from './company-profile.dto';
import { LOGO_MAX_BYTES } from './logo-image';

type U = AccessPrincipal & { id: string };
const optInt = (v?: string) => (v === undefined || v === '' ? undefined : Number(v));

/**
 * The WMS owner's company identity for customer documents. Any signed-in user
 * may read it (it is printed on documents anyway); only settings.manage edits it.
 */
@ApiTags('Company profile')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('company-profile')
export class CompanyProfileController {
  constructor(private readonly svc: CompanyProfileService) {}

  @Get()
  get(@CurrentUser() u: U) {
    return this.svc.get(u);
  }

  @Get('logo')
  @ApiOperation({ summary: 'Official logo as a data URL (null when none is set)' })
  logo() {
    return this.svc.logo();
  }

  @Put()
  @UseGuards(AccessGuard)
  @Access(ACCESS.settings)
  update(@Body() dto: UpdateCompanyProfileDto, @CurrentUser() u: U) {
    return this.svc.update(dto, u);
  }

  @Post('logo')
  @UseGuards(AccessGuard)
  @Access(ACCESS.settings)
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload or replace the official logo (PNG/JPEG, max 1 MB)' })
  // One byte over the limit is enough to refuse; the content is checked again in the service.
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: LOGO_MAX_BYTES + 1, files: 1 } }))
  upload(@UploadedFile() file: Express.Multer.File, @Query('version') version: string | undefined, @CurrentUser() u: U) {
    return this.svc.setLogo(file, optInt(version), u);
  }

  @Delete('logo')
  @UseGuards(AccessGuard)
  @Access(ACCESS.settings)
  remove(@Query('version') version: string | undefined, @CurrentUser() u: U) {
    return this.svc.removeLogo(optInt(version), u);
  }
}
