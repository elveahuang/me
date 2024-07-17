import { BaseEntity } from '@/commons/entity/base.entity';
import { Column, Entity } from 'typeorm';

@Entity('sys_banner')
export class BannerEntity extends BaseEntity {
    @Column({ name: 'title', comment: '标题' })
    title: string;

    @Column({ name: 'description', comment: '备注' })
    description: string;

    @Column({ name: 'idx', comment: '序号' })
    idx: number;

    @Column({ name: 'start_datetime', comment: '发布开始日期' })
    startDatetime: Date;

    @Column({ name: 'end_datetime', comment: '发布结束日期' })
    endDatetime: Date;

    @Column({ name: 'status', comment: '状态' })
    status: number;
}
