import { Module } from '@nestjs/common';
import { BackendResourcesClient } from './backend-resources.client.js';

@Module({ providers: [BackendResourcesClient], exports: [BackendResourcesClient] })
export class ResourcesModule {}
