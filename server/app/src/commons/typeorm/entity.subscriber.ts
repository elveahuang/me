import { IdEntity } from '@/commons/entity/id.entity';
import { SequenceService } from '@/commons/service/sequence.service';
import { Injectable } from '@nestjs/common';
import { DataSource, EntitySubscriberInterface, EventSubscriber, InsertEvent, UpdateEvent } from 'typeorm';

@Injectable()
@EventSubscriber()
export class EntitySubscriber implements EntitySubscriberInterface {
    constructor(
        protected readonly dataSource: DataSource,
        protected readonly sequenceService: SequenceService,
    ) {
        dataSource.subscribers.push(this);
    }

    beforeInsert(event: InsertEvent<IdEntity>): void {
        if (event.entity instanceof IdEntity) {
            event.entity.id = this.sequenceService.nextId().toString();
            console.log(`EntitySubscriber.beforeInsert. generate id - ${event.entity.id}.`);
        }
    }

    beforeUpdate(event: UpdateEvent<IdEntity>): void {
        if (event.entity instanceof IdEntity) {
            console.log(`EntitySubscriber.beforeUpdate. generate id - ${event.entity.id}.`);
        }
    }
}
