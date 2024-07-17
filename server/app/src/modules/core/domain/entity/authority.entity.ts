import { BaseEntity } from '@/commons/entity/base.entity';
import { Column, Entity } from 'typeorm';

@Entity('sys_authority')
export class AuthorityEntity extends BaseEntity {
    @Column({ name: 'parent_id', comment: '父ID', type: 'bigint' })
    parentId: bigint;

    @Column({ name: 'code', comment: '编号' })
    code: string;

    @Column({ name: 'title', comment: '标题' })
    title: string;

    @Column({ name: 'label', comment: '文本' })
    label: string;

    @Column({ name: 'description', comment: '备注' })
    description: string;

    @Column({ name: 'type', comment: '类型' })
    type: string;

    @Column({ name: 'idx', comment: '序号' })
    idx: number;

    @Column({ name: 'status', comment: '状态' })
    status: number;

    @Column({ name: 'source', comment: '来源' })
    source: number;
}
