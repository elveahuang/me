import { BaseEntity } from '@/commons/entity/base.entity';
import { Column, Entity } from 'typeorm';

@Entity('sys_config')
export class ConfigEntity extends BaseEntity {
    @Column({ name: 'code', comment: '编号' })
    code: string;

    @Column({ name: 'title', comment: '标题' })
    title: string;

    @Column({ name: 'label', comment: '文本' })
    label: string;

    @Column({ name: 'value', comment: '配置内容' })
    value: string;

    @Column({ name: 'default_value', comment: '默认值' })
    defaultValue: string;

    @Column({ name: 'description', comment: '备注' })
    description: string;

    @Column({ name: 'source', comment: '来源' })
    source: number;
}
