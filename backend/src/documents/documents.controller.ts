import { Controller, Get, Param, Res, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import type { Response } from 'express';
import { DocumentsService } from './documents.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('Documents')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('documents')
export class DocumentsController {
  constructor(private readonly docs: DocumentsService) {}

  @Get('picking-slip/:requestId')
  @ApiOperation({ summary: 'Generate picking slip PDF for a request' })
  async pickingSlip(@Param('requestId') requestId: string, @Res() res: Response) {
    const pdf = await this.docs.pickingSlip(requestId);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="picking-slip-${requestId.slice(-8)}.pdf"`,
    });
    res.send(pdf);
  }

  @Get('cover-sheet/:requestId')
  @ApiOperation({ summary: 'Generate cover sheet PDF for a request' })
  async coverSheet(@Param('requestId') requestId: string, @Res() res: Response) {
    const pdf = await this.docs.coverSheet(requestId);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="cover-sheet-${requestId.slice(-8)}.pdf"`,
    });
    res.send(pdf);
  }
}
