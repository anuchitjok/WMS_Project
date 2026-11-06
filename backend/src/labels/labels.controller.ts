import { Controller, Post, Body, Param, Res, UseGuards, BadRequestException, ForbiddenException } from '@nestjs/common';
import { ACCESS, hasAccess } from '../auth/access';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import type { Response } from 'express';
import { LabelsService } from './labels.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

const ids = (v: unknown): string[] | undefined =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.length > 0) : undefined;

@ApiTags('Labels')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('labels')
export class LabelsController {
  constructor(private readonly labels: LabelsService) {}

  @Post(':type/print')
  @ApiOperation({ summary: 'Render labels as PDF (type: product | bin | serial). bin takes locations (WH|RACK|SLOT keys), slotIds, rackIds or warehouseIds.' })
  async print(
    @Param('type') type: string,
    @Body() body: { ids?: string[]; locations?: string[]; slotIds?: string[]; rackIds?: string[]; warehouseIds?: string[] },
    @Res() res: Response,
    @CurrentUser() user?: any,
  ) {
    let pdf: Buffer;
    if (type === 'product') pdf = await this.labels.productLabels(body.ids ?? []);
    else if (type === 'serial') pdf = await this.labels.serialLabels(body.ids ?? []);
    else if (type === 'bin') {
      // Printing a whole rack / warehouse of location labels is a warehouse-floor job.
      const bulk = !!(body.slotIds?.length || body.rackIds?.length || body.warehouseIds?.length);
      if (bulk && !hasAccess(user, ACCESS.putaway)) throw new ForbiddenException('Not allowed to print location labels');
      pdf = await this.labels.binLabels({
        locations: ids(body.locations),
        slotIds: ids(body.slotIds),
        rackIds: ids(body.rackIds),
        warehouseIds: ids(body.warehouseIds),
      }, user);
    } else throw new BadRequestException(`Unknown label type: ${type}`);

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="labels-${type}-${new Date().toISOString().slice(0, 10)}.pdf"`,
    });
    res.send(pdf);
  }
}
