import { Snowflake } from '@/commons/utils/snowflake';
import { Injectable } from '@nestjs/common';

@Injectable()
export class SequenceService {
    sequence: Snowflake;

    constructor() {
        this.sequence = new Snowflake({});
    }

    /**
     * 获取当前系统时间
     */
    public nextId(): bigint {
        return this.sequence.nextId();
    }
}
