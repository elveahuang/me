import { ServiceException } from '@/commons/exception/service.exception';
import { Principal } from '@/commons/security/principal';
import { AuthService } from '@/modules/auth/service/auth.service';
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { isEmpty } from 'radash';

@Injectable()
export class AppAuthGuard implements CanActivate {
    constructor(
        private readonly reflector: Reflector,
        private readonly authService: AuthService,
    ) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        console.log('AppAuthGuard.canActivate()...');

        // 是否允许匿名访问
        const anonymous: boolean = this.reflector.get<boolean>('anonymous', context.getHandler());
        const request = context.switchToHttp().getRequest();
        const principal: Principal = request.principal as Principal;

        // 当用户信息未空时，尝试从Header里面获取访问凭证来完成用户认证
        if (isEmpty(principal)) {
            if (request.headers.authorization && (request.headers.authorization as string).split(' ')[0] === 'Bearer') {
                const token: string = (request.headers.authorization as string).split(' ')[1];
                try {
                    request.principal = await this.authService.validate(token);
                } catch (e) {
                    console.log(e);
                    if (!anonymous) {
                        throw new ServiceException();
                    }
                }
            }
        }

        // 允许匿名访问
        if (anonymous) {
            return true;
        }

        // 获取方法注解标注的所需要的角色和权限，当方法未标注时，直接按需要登录来处理。
        const roles: string[] = this.reflector.get<string[]>('roles', context.getHandler());
        const authorities: string[] = this.reflector.get<string[]>('authorities', context.getHandler());
        if (isEmpty(roles) && isEmpty(authorities)) {
            return true;
        }
        return (
            (!isEmpty(roles) && this.authService.hasAnyRoles(principal, roles)) ||
            (!isEmpty(authorities) && this.authService.hasAnyAuthorities(principal, authorities))
        );
    }
}
