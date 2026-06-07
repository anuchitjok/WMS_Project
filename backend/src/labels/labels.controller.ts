import { Controller, Post, Body, Param, Res, UseGuards, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import type { Response } from 'express';
import { LabelsService } from './labels.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('Labels')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('labels')
export class LabelsController {
  constructor(private readonly labels: LabelsService) {}

  @Post(':type/print')
  @ApiOperation({ summary: 'Render labels as PDF (type: product | bin | serial)' })
  async print(
    @Param('type') type: string,
    @Body() body: { ids?: string[]; locations?: string[] },
    @Res() res: Response,
  ) {
    let pdf: Buffer;
    if (type === 'product') pdf = await this.labels.productLabels(body.ids ?? []);
    else if (type === 'serial') pdf = await this.labels.serialLabels(body.ids ?? []);
    else if (type === 'bin') pdf = await this.labels.binLabels(body.locations ?? []);
    else throw new BadRequestException(`Unknown label type: ${type}`);

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="labels-${type}-${new Date().toISOString().slice(0, 10)}.pdf"`,
    });
    res.send(pdf);
  }
}
