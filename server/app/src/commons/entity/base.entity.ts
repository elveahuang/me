import { IdEntity } from '@/commons/entity/id.entity';
import { BeforeInsert, BeforeUpdate, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

export abstract class BaseEntity extends IdEntity {
    @Column({ name: 'active', comment: '启用状态' })
    active: number;

    @CreateDateColumn({ name: 'created_at', comment: '创建时间' })
    createdAt: Date;

    @Column({ name: 'created_by', comment: '创建人', type: 'bigint' })
    createdBy: bigint;

    @UpdateDateColumn({ name: 'last_modified_at', comment: '最后修改时间' })
    lastModifiedAt: Date;

    @Column({ name: 'last_modified_by', comment: '最后修改人', type: 'bigint' })
    lastModifiedBy: bigint;

    @UpdateDateColumn({ name: 'deleted_at', comment: '删除时间' })
    deletedAt: Date;

    @Column({ name: 'deleted_by', comment: '删除人', type: 'bigint' })
    deletedBy: bigint;

    @BeforeInsert()
    onBeforeInsert(): void {
        this.createdAt = new Date();
        this.lastModifiedAt = new Date();
    }

    @BeforeUpdate()
    onBeforeUpdate(): void {
        this.lastModifiedAt = new Date();
    }
}
