import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { validateEnv } from './config/env.validation';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { InventoryModule } from './inventory/inventory.module';
import { WarehouseModule } from './warehouse/warehouse.module';
import { RequestsModule } from './requests/requests.module';
import { RtvModule } from './rtv/rtv.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { AuditModule } from './audit/audit.module';
import { RealtimeModule } from './realtime/realtime.module';
import { ReceivingModule } from './receiving/receiving.module';
import { PutawayModule } from './putaway/putaway.module';
import { FulfillmentModule } from './fulfillment/fulfillment.module';
import { RmaModule } from './rma/rma.module';
import { DoaModule } from './doa/doa.module';
import { UnusedModule } from './unused/unused.module';
import { AdjustmentModule } from './adjustment/adjustment.module';
import { TransferModule } from './transfer/transfer.module';
import { ProductsModule } from './products/products.module';
import { SettingsModule } from './settings/settings.module';
import { ReportsModule } from './reports/reports.module';
import { DataioModule } from './dataio/dataio.module';
import { RolesModule } from './roles/roles.module';
import { RbacModule } from './rbac/rbac.module';
import { ScanModule } from './scan/scan.module';
import { LabelsModule } from './labels/labels.module';
import { Fulfillment2Module } from './fulfillment2/fulfillment2.module';
import { ShipmentModule } from './shipment/shipment.module';
import { NotificationsModule } from './notifications/notifications.module';
import { SlaModule } from './sla/sla.module';
import { CycleCountModule } from './cycle-count/cycle-count.module';
import { ApprovalModule } from './approval/approval.module';
import { ScrapModule } from './scrap/scrap.module';
import { DocumentsModule } from './documents/documents.module';
import { ScheduleModule } from '@nestjs/schedule';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    ScheduleModule.forRoot(),
    // Global rate limiting — 100 requests / minute per IP by default
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
    PrismaModule,
    RbacModule,
    AuthModule,
    UsersModule,
    InventoryModule,
    WarehouseModule,
    RequestsModule,
    RtvModule,
    DashboardModule,
    AuditModule,
    RealtimeModule,
    ReceivingModule,
    PutawayModule,
    FulfillmentModule,
    RmaModule,
    DoaModule,
    UnusedModule,
    AdjustmentModule,
    TransferModule,
    ProductsModule,
    SettingsModule,
    ReportsModule,
    DataioModule,
    RolesModule,
    ScanModule,
    LabelsModule,
    Fulfillment2Module,
    ShipmentModule,
    NotificationsModule,
    SlaModule,
    CycleCountModule,
    ApprovalModule,
    ScrapModule,
    DocumentsModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // Apply rate limiting globally
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    // Catch-all exception filter for consistent error responses
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    // Centralized request logging
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
  ],
})
export class AppModule {}
