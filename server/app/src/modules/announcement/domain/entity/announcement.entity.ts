import { BaseEntity } from '@/commons/entity/base.entity';
import { Column, Entity } from 'typeorm';

@Entity('sys_announcement')
export class AnnouncementEntity extends BaseEntity {
    @Column({ name: 'title', comment: '标题' })
    title: string;

    @Column({ name: 'content', comment: '备注' })
    content: string;

    @Column({ name: 'description', comment: '备注' })
    description: string;

    @Column({ name: 'start_datetime', comment: '发布开始日期' })
    startDatetime: Date;

    @Column({ name: 'end_datetime', comment: '发布结束日期' })
    endDatetime: Date;

    @Column({ name: 'status', comment: '状态' })
    status: number;
}
