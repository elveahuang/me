import { SimpleEntity } from '@/commons/entity/simple.entity';
import { Column, Entity } from 'typeorm';

@Entity('sys_lang')
export class LangEntity extends SimpleEntity {
    @Column({ name: 'code', comment: '编号' })
    code: string;

    @Column({ name: 'title', comment: '标题' })
    title: string;

    @Column({ name: 'label', comment: '文本' })
    label: string;

    @Column({ name: 'description', comment: '备注' })
    description: string;

    @Column({ name: 'lang', comment: '语言' })
    lang: string;

    @Column({ name: 'country', comment: '国家' })
    country: string;

    @Column({ name: 'default_ind', comment: '是否默认语言' })
    defaultInd: number;

    @Column({ name: 'status', comment: '状态' })
    status: number;

    @Column({ name: 'source', comment: '来源' })
    source: number;
}
