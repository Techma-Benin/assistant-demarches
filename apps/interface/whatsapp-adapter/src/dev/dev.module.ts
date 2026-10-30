import { Module } from '@nestjs/common';
import { MetaModule } from '../meta/meta.module.js';
import { DevController } from './dev.controller.js';

@Module({ imports: [MetaModule], controllers: [DevController] })
export class DevModule {}
