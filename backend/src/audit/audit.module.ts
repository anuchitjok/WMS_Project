import { Module } from '@nestjs/common';
import { AuditService } from './audit.service';
import { AuditController } from './audit.controller';
import { AuditRetentionService } from './audit-retention.service';
import { AuditRetentionController } from './audit-retention.controller';

@Module({
  controllers: [AuditRetentionController, AuditController],
  providers: [AuditService, AuditRetentionService],
  exports: [AuditService],
})
export class AuditModule {}
