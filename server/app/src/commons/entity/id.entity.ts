import { PrimaryGeneratedColumn } from 'typeorm';

export class IdEntity {
    @PrimaryGeneratedColumn({ type: 'bigint', name: 'id', comment: 'ID', unsigned: true })
    id: string;
}
