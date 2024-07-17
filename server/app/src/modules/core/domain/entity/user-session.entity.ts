import { IdEntity } from '@/commons/entity/id.entity';
import { Column, Entity } from 'typeorm';

@Entity('sys_user_session')
export class UserSessionEntity extends IdEntity {
    @Column({ type: 'bigint', name: 'user_id' })
    userId: string;
    @Column({ name: 'session_id' })
    sessionId: string;
    @Column({ name: 'username' })
    username: string;
    @Column({ name: 'ip' })
    ip: string;
    @Column({ name: 'ua' })
    ua: string;
    @Column({ name: 'client_id' })
    clientId: string;
    @Column({ name: 'client_version' })
    clientVersion: string;
    @Column({ name: 'start_datetime' })
    startDatetime: Date;
    @Column({ name: 'start_year', comment: '退出时间' })
    startYear: number;
    @Column({ name: 'start_month', comment: '退出时间' })
    startMonth: number;
    @Column({ name: 'start_day', comment: '退出时间' })
    startDay: number;
    @Column({ name: 'start_hour', comment: '退出时间' })
    startHour: number;
    @Column({ name: 'start_minute', comment: '退出时间' })
    startMinute: number;
    @Column({ name: 'last_access_datetime', comment: '退出时间' })
    lastAccessDatetime: Date;
    @Column({ name: 'last_access_year', comment: '退出时间' })
    lastAccessYear: number;
    @Column({ name: 'last_access_month', comment: '退出时间' })
    lastAccessMonth: number;
    @Column({ name: 'last_access_day', comment: '退出时间' })
    lastAccessDay: number;
    @Column({ name: 'last_access_hour', comment: '退出时间' })
    lastAccessHour: number;
    @Column({ name: 'last_access_minute', comment: '退出时间' })
    lastAccessMinute: number;
    @Column({ name: 'end_datetime', comment: '退出时间' })
    endDatetime: Date;
    @Column({ name: 'end_year', comment: '退出时间' })
    endYear: number;
    @Column({ name: 'end_month', comment: '退出时间' })
    endMonth: number;
    @Column({ name: 'end_day', comment: '退出时间' })
    endDay: number;
    @Column({ name: 'end_hour', comment: '退出时间' })
    endHour: number;
    @Column({ name: 'end_minute', comment: '退出时间' })
    endMinute: number;
}
