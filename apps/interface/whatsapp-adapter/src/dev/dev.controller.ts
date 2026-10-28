import { Controller, Get, HttpCode, Inject, Param, Post, Req } from '@nestjs/common';
import { ProblemException } from '../common/problem.js';
import type { RawBodyRequest } from '../common/raw-body.js';
import { FakeMetaMedia, RecordingMetaSender, maskPhone } from '../meta/fakes.js';
import { FAKE_META_MEDIA, RECORDING_META_SENDER } from '../tokens.js';

/** Routes réservées au développement (non enregistrées quand NODE_ENV=production). */
@Controller('dev')
export class DevController {
  constructor(
    @Inject(RECORDING_META_SENDER) private readonly recording: RecordingMetaSender,
    @Inject(FAKE_META_MEDIA) private readonly fakeMedia: FakeMetaMedia,
  ) {}

  @Get('outbox')
  outbox() {
    return this.recording.list().map((r) => ({ to: maskPhone(r.to), message: r.message, at: r.at }));
  }

  @Post('media/:id')
  @HttpCode(204)
  registerMedia(@Param('id') id: string, @Req() req: RawBodyRequest): void {
    const bytes = req.rawBody;
    if (!bytes || bytes.length === 0) throw new ProblemException(400, 'INVALID_REQUEST', 'Corps binaire requis');
    this.fakeMedia.register(id, bytes);
  }
}
