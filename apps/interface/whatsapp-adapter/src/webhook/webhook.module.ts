import { Module } from '@nestjs/common';
import { BackendModule } from '../backend/backend.module.js';
import { MetaModule } from '../meta/meta.module.js';
import { INBOUND_PROCESSOR, INBOUND_QUEUE } from '../tokens.js';
import { InMemoryInboundQueue } from './inbound-queue.js';
import { InboundProcessor } from './inbound-processor.js';
import { MetaWebhookController } from './meta-webhook.controller.js';

@Module({
  imports: [BackendModule, MetaModule],
  controllers: [MetaWebhookController],
  providers: [
    { provide: INBOUND_PROCESSOR, useClass: InboundProcessor },
    { provide: INBOUND_QUEUE, inject: [INBOUND_PROCESSOR], useFactory: (p: InboundProcessor) => new InMemoryInboundQueue(p) },
  ],
  exports: [INBOUND_PROCESSOR, INBOUND_QUEUE],
})
export class WebhookModule {}
