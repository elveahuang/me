import { BaseEntity } from '@/commons/entity/base.entity';
import { IdEntity } from '@/commons/entity/id.entity';
import { SimpleEntity } from '@/commons/entity/simple.entity';

export type Entity = BaseEntity | IdEntity | SimpleEntity;
