import { Body, Controller, Get, Param, Post, Res, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import type { Response } from 'express';
import { DocumentsService } from './documents.service';
import { RequestRefService } from './request-ref.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AccessGuard } from '../auth/guards/access.guard';
import { Access } from '../auth/decorators/access.decorator';
import { ACCESS } from '../auth/access';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@ApiTags('Documents')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AccessGuard)
@Controller('documents')
export class DocumentsController {
  constructor(
    private readonly docs: DocumentsService,
    private readonly refs: RequestRefService,
  ) {}

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

  // ── Request QR page (plan P5 5.3) ─────────────────────────────────────────

  @Get('ref/:ref')
  @ApiOperation({ summary: 'Request QR page data — receipt view for the requester, pick list for the warehouse, else view NONE' })
  refView(@Param('ref') ref: string, @CurrentUser() user: any) {
    return this.refs.view(ref, user);
  }

  @Post('ref/:ref/confirm-receipt')
  @ApiOperation({ summary: 'Requester confirms receipt — runs the existing handover (idempotent)' })
  confirmReceipt(@Param('ref') ref: string, @Body() body: { version?: number }, @CurrentUser() user: any) {
    const v = body?.version;
    return this.refs.confirmReceipt(ref, user, typeof v === 'number' && Number.isFinite(v) ? v : null);
  }

  @Access(ACCESS.fulfillment)
  @Get('ref/:ref/qr')
  @ApiOperation({ summary: 'QR (SVG) of the request link, for showing on screen at handover' })
  refQr(@Param('ref') ref: string) {
    return this.refs.qr(ref);
  }
}
