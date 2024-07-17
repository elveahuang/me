import { ServiceException } from '@/commons/exception/service.exception';
import { Principal } from '@/commons/security/principal';
import { R } from '@/commons/types';
import { uuid } from '@/commons/utils';
import { compare } from '@/commons/utils/encrypt';
import { Web } from '@/commons/utils/web';
import { RequestContext } from '@/commons/web/request-context';
import { CredentialsDto } from '@/modules/auth/dto/credentials.dto';
import { JwtPayload, JwtResponse } from '@/modules/auth/passport/jwt.type';
import { AuthorityEntity } from '@/modules/core/domain/entity/authority.entity';
import { RoleEntity } from '@/modules/core/domain/entity/role.entity';
import { UserEntity } from '@/modules/core/domain/entity/user.entity';
import { AuthorityService } from '@/modules/core/service/authority.service';
import { RoleService } from '@/modules/core/service/role.service';
import { UserSessionService } from '@/modules/core/service/user-session.service';
import { UserService } from '@/modules/core/service/user.service';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { isArray, isEmpty, isEqual, isString } from 'radash';

@Injectable()
export class AuthService {
    constructor(
        private jwtService: JwtService,
        private configService: ConfigService,
        private userSessionService: UserSessionService,
        private userService: UserService,
        private roleService: RoleService,
        private authorityService: AuthorityService,
    ) {}

    createAccessToken(payload: JwtPayload): string {
        return this.jwtService.sign(payload);
    }

    createRefreshToken(payload: JwtPayload): string {
        return this.jwtService.sign(payload, { expiresIn: this.configService.get<number>('JWT_REFRESH_TOKEN_EXPIRE') });
    }

    hasAnyRoles(principal: Principal, roles: string[] | string): boolean {
        if (isArray(roles) && roles.length > 0) {
            return roles.some((role: string) => {
                return principal?.roles?.includes(role);
            });
        } else if (isString(roles)) {
            return principal?.roles?.includes(roles);
        }
        return false;
    }

    hasAnyAuthorities(principal: Principal, authorities: string[] | string): boolean {
        if (isArray(authorities) && authorities.length > 0) {
            return authorities.some((role: string) => {
                return principal?.authorities?.includes(role);
            });
        } else if (isString(authorities)) {
            return principal?.authorities?.includes(authorities);
        }
        return false;
    }

    async validate(accessToken: string): Promise<Principal> {
        const payload: JwtPayload = this.jwtService.decode<JwtPayload>(accessToken);
        const uid = payload.uid;
        const sid = payload.sid;
        const roles: RoleEntity[] = await this.roleService.findByUserId(uid);
        const authorities: AuthorityEntity[] = await this.authorityService.findByUserId(uid);
        return {
            uid: uid,
            sid: sid,
            username: payload.username,
            nickname: payload.username,
            authorities: authorities.map((a: AuthorityEntity) => a.code),
            roles: roles.map((r: RoleEntity) => r.code),
        } as Principal;
    }

    async auth(credentials: CredentialsDto, context: RequestContext = {}): Promise<R<JwtResponse>> {
        if (isEqual(credentials.grant_type, 'password')) {
            const user: UserEntity = await this.userService.findByUsername(credentials.username);
            if (user && (await compare(credentials.password, user.password))) {
                // 生成访问凭证
                const sid: string = uuid();
                const payload: JwtPayload = {
                    sub: sid,
                    sid: sid,
                    uid: user.id,
                    username: user.username,
                };
                const roles: RoleEntity[] = await this.roleService.findByUserId(user.id);
                console.log(roles.length);
                const accessToken: string = this.createAccessToken(payload);
                const refreshToken: string = this.createRefreshToken(payload);
                // 保存会话记录
                this.userSessionService.createUserSession(payload, context).then();

                return Web.success({
                    access_token: accessToken,
                    refresh_token: refreshToken,
                } as JwtResponse);
            } else {
                throw new ServiceException(10000, 'Invalid username or password.');
            }
        } else if (isEqual(credentials.grant_type, 'refresh_token')) {
            if (!isEmpty(credentials.refresh_token)) {
                const payload: JwtPayload = this.jwtService.decode<JwtPayload>(credentials.refresh_token);
                const accessToken: string = this.createAccessToken({
                    sid: payload.sid,
                    sub: payload.sid,
                    uid: payload.uid,
                    username: payload.username,
                });

                // 更新会话记录
                this.userSessionService.updateUserSession(payload).then();

                return Web.success({
                    access_token: accessToken,
                    refresh_token: credentials.refresh_token,
                } as JwtResponse);
            } else {
                throw new ServiceException(10000, 'Invalid Refresh Token.');
            }
        }
        throw new ServiceException(10000, 'Bad Request.');
    }
}
