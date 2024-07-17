import { Logger } from '@/commons/service/logger.service';
import { SequenceService } from '@/commons/service/sequence.service';
import { EntitySubscriber } from '@/commons/typeorm/entity.subscriber';
import { Module } from '@nestjs/common';

@Module({
    providers: [SequenceService, Logger, EntitySubscriber],
    exports: [SequenceService, Logger, EntitySubscriber],
})
export class CommonsModule {
    constructor() {}
}
