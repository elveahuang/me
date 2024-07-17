import { UserSessionEntity } from '@/modules/core/domain/entity/user-session.entity';
import { Repository } from 'typeorm';

export interface UserSessionRepository extends Repository<UserSessionEntity> {
    this: Repository<UserSessionEntity>;

    findBySessionId(sid: string): Promise<UserSessionEntity>;
}

export const UserSessionRepositoryImpl: Pick<UserSessionEntity, any> = {
    async findBySessionId(this: Repository<UserSessionEntity>, sid: string): Promise<UserSessionEntity> {
        return this.createQueryBuilder('s').where('s.sessionId = :sessionId', { sessionId: sid }).getOne();
    },
};
