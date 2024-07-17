import { IdEntity } from '@/commons/entity/id.entity';
import { BeforeInsert, Column, CreateDateColumn } from 'typeorm';

export class SimpleEntity extends IdEntity {
    @Column({ name: 'active', comment: 'active' })
    active: number;

    @CreateDateColumn({ name: 'created_at', comment: '创建时间' })
    createdAt: Date;

    @Column({ name: 'created_by', comment: '创建人', type: 'bigint' })
    createdBy: bigint;

    @BeforeInsert()
    onBeforeInsert(): void {
        this.createdAt = new Date();
    }
}
