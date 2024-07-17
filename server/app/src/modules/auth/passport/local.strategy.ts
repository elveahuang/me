import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-local';
import { AuthService } from '../service/auth.service';

@Injectable()
export class LocalStrategy extends PassportStrategy(Strategy, 'local') {
    constructor(private authService: AuthService) {
        super();
    }

    async validate(username: string, password: string): Promise<any> {
        const user = await this.authService.auth({
            grant_type: password,
            username: username,
            password: password,
        });
        if (!user) {
            throw new UnauthorizedException();
        }
        return user;
    }
}
