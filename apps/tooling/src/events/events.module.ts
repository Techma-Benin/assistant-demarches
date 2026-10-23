import { Global, Module } from '@nestjs/common';
import { Outbox } from './outbox.js';

@Global()
@Module({ providers: [Outbox], exports: [Outbox] })
export class EventsModule {}
