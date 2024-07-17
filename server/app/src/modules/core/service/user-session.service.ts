import { EntityService } from '@/commons/service/entity.service';
import { RequestContext } from '@/commons/web/request-context';
import { JwtPayload } from '@/modules/auth/passport/jwt.type';
import { UserSessionEntity } from '@/modules/core/domain/entity/user-session.entity';
import { UserSessionRepository } from '@/modules/core/repository/user-session.repository';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

@Injectable()
export class UserSessionService extends EntityService<UserSessionEntity, UserSessionRepository> {
    constructor(@InjectRepository(UserSessionEntity) readonly userSessionRepository: UserSessionRepository) {
        super(userSessionRepository);
    }

    async findAll(): Promise<UserSessionEntity[]> {
        return this.userSessionRepository.find();
    }

    async createUserSession(payload: JwtPayload, context: RequestContext = {}): Promise<UserSessionEntity> {
        const now: Date = new Date();

        const session: UserSessionEntity = new UserSessionEntity();
        session.userId = payload.uid;
        session.sessionId = payload.sid;
        session.username = payload.username;
        session.ip = context?.ip || '';
        session.ua = context?.ua || '';
        session.clientId = context?.clientVersion || '';
        session.clientVersion = context?.clientVersion || '';
        session.startDatetime = now;
        session.startYear = now.getFullYear();
        session.startMonth = now.getMonth();
        session.startDay = now.getDate();
        session.startHour = now.getHours();
        session.startMinute = now.getMinutes();
        return await this.userSessionRepository.save(session);
    }

    async updateUserSession(payload: JwtPayload, context: RequestContext = {}): Promise<UserSessionEntity> {
        const now: Date = new Date();

        const session: UserSessionEntity = await this.userSessionRepository.findBySessionId(payload.sid);
        session.ip = context?.ip || '';
        session.ua = context?.ua || '';
        session.clientId = context?.clientVersion || '';
        session.clientVersion = context?.clientVersion || '';
        session.lastAccessDatetime = now;
        session.lastAccessYear = now.getFullYear();
        session.lastAccessMonth = now.getMonth();
        session.lastAccessDay = now.getDate();
        session.lastAccessHour = now.getHours();
        session.lastAccessMinute = now.getMinutes();
        return await this.userSessionRepository.save(session);
    }

    async endUserSession(payload: JwtPayload, context: RequestContext = {}): Promise<UserSessionEntity> {
        const now: Date = new Date();

        const session: UserSessionEntity = await this.userSessionRepository.findBySessionId(payload.sid);
        session.endDatetime = now;
        session.endYear = now.getFullYear();
        session.endMonth = now.getMonth();
        session.endDay = now.getDate();
        session.endHour = now.getHours();
        session.endMinute = now.getMinutes();
        return await this.userSessionRepository.save(session);
    }
}
