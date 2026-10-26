import { Module } from '@nestjs/common';
import { APP_CONFIG, FAKE_META_MEDIA, META_MEDIA, META_SENDER, OUTBOUND_QUEUE, RECORDING_META_SENDER } from '../tokens.js';
import type { AppConfig } from '../config/config.js';
import { FakeMetaMedia, RecordingMetaSender } from './fakes.js';
import { GraphApiMetaMedia, GraphApiMetaSender } from './graph-api.js';
import type { MetaSender } from './meta.js';
import { InMemoryOutboundQueue } from './outbound-queue.js';

const graphOptions = (config: AppConfig) => ({
  accessToken: config.meta.accessToken ?? '',
  graphVersion: config.meta.graphVersion,
});

@Module({
  providers: [
    { provide: RECORDING_META_SENDER, useFactory: () => new RecordingMetaSender() },
    { provide: FAKE_META_MEDIA, useFactory: () => new FakeMetaMedia() },
    {
      provide: META_SENDER,
      inject: [APP_CONFIG, RECORDING_META_SENDER],
      useFactory: (config: AppConfig, recording: RecordingMetaSender) =>
        config.meta.useGraphApi
          ? new GraphApiMetaSender({ ...graphOptions(config), phoneNumberId: config.meta.phoneNumberId ?? '' })
          : recording,
    },
    {
      provide: META_MEDIA,
      inject: [APP_CONFIG, FAKE_META_MEDIA],
      useFactory: (config: AppConfig, fake: FakeMetaMedia) =>
        config.meta.useGraphApi ? new GraphApiMetaMedia(graphOptions(config)) : fake,
    },
    { provide: OUTBOUND_QUEUE, inject: [META_SENDER], useFactory: (sender: MetaSender) => new InMemoryOutboundQueue(sender) },
  ],
  exports: [META_SENDER, META_MEDIA, RECORDING_META_SENDER, FAKE_META_MEDIA, OUTBOUND_QUEUE],
})
export class MetaModule {}
