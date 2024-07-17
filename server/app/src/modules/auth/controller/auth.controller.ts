import { Anonymous } from '@/commons/decorator/anonymous.decorator';
import { Context } from '@/commons/decorator/context.decorator';
import { SequenceService } from '@/commons/service/sequence.service';
import { Web } from '@/commons/utils/web';
import { RequestContext } from '@/commons/web/request-context';
import { CredentialsDto } from '@/modules/auth/dto/credentials.dto';
import { LocalAuthGuard } from '@/modules/auth/passport/local.guard';
import { AuthService } from '@/modules/auth/service/auth.service';
import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Controller()
export class AuthController {
    constructor(
        private readonly configService: ConfigService,
        private readonly sequenceService: SequenceService,
        private readonly authService: AuthService,
    ) {}

    /**
     * Form Login
     */
    @Anonymous()
    @UseGuards(LocalAuthGuard)
    @Post('/auth/login')
    async login(@Req() reg: any): Promise<any> {
        return reg.user;
    }

    /**
     * JWT Login
     */
    @Anonymous()
    @Post('/auth/token')
    async token(@Body() credentials: CredentialsDto, @Context() context: RequestContext): Promise<any> {
        return this.authService.auth(credentials, context);
    }

    /**
     * JWT User
     */
    @Get('/api/user')
    async me(@Req() req: any): Promise<any> {
        return Web.success(req.principal);
    }
}
