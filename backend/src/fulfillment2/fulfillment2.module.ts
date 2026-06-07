// fulfillment2.module.ts — Backward-compatibility module.
// Imports FulfillmentModule to reuse the canonical services.
//
// @deprecated TODO_REMOVE_AFTER_MIGRATION — delete this module (and unregister it
// from app.module.ts) once all clients have migrated from /fulfillment2 to /fulfillment.
import { Module } from '@nestjs/common';
import { Fulfillment2Service }    from './fulfillment2.service';
import { Fulfillment2Controller } from './fulfillment2.controller';
import { FulfillmentModule }      from '../fulfillment/fulfillment.module';

@Module({
  imports: [FulfillmentModule],
  controllers: [Fulfillment2Controller],
  providers: [Fulfillment2Service],
  exports: [Fulfillment2Service],
})
export class Fulfillment2Module {}
