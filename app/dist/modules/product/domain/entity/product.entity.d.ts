import { BaseEntity } from '@/commons/entity/base.entity';
export declare class ProductEntity extends BaseEntity {
    code: string;
    title: string;
    content: string;
    description: string;
    idx: number;
    startDatetime: Date;
    endDatetime: Date;
    status: number;
}
