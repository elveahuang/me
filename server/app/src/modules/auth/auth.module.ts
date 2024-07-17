import { CommonsModule } from '@/commons/commons.module';
import { AuthController } from '@/modules/auth/controller/auth.controller';
import { AppAuthGuard } from '@/modules/auth/passport/app.guard';
import { JwtStrategy } from '@/modules/auth/passport/jwt.strategy';
import { LocalStrategy } from '@/modules/auth/passport/local.strategy';
import { AuthService } from '@/modules/auth/service/auth.service';
import { CoreModule } from '@/modules/core/core.module';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { JwtModuleOptions } from '@nestjs/jwt/dist/interfaces/jwt-module-options.interface';
import { PassportModule } from '@nestjs/passport';

@Module({
    imports: [
        JwtModule.registerAsync({
            imports: [ConfigModule],
            inject: [ConfigService],
            useFactory: async (configService: ConfigService): Promise<JwtModuleOptions> => {
                console.log(`JwtModule.useFactory...`);
                return {
                    global: true,
                    secret: configService.get<string>('JWT_SECRET'),
                    signOptions: { expiresIn: configService.get<number>('JWT_ACCESS_TOKEN_EXPIRE') },
                } as JwtModuleOptions;
            },
        }),
        PassportModule.register({ defaultStrategy: 'jwt' }),
        CommonsModule,
        CoreModule,
    ],
    controllers: [AuthController],
    providers: [
        AuthService,
        LocalStrategy,
        JwtStrategy,
        {
            provide: APP_GUARD,
            useClass: AppAuthGuard,
        },
    ],
    exports: [AuthService],
})
export class AuthModule {}
