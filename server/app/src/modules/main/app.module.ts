import { CommonsModule } from '@/commons/commons.module';
import { loadEnv } from '@/config/env';
import { AccountModule } from '@/modules/account/account.module';
import { AnnouncementModule } from '@/modules/announcement/announcement.module';
import { AttachmentModule } from '@/modules/attachment/attachment.module';
import { AuthModule } from '@/modules/auth/auth.module';
import { BannerModule } from '@/modules/banner/banner.module';
import { CatalogModule } from '@/modules/catalog/catalog.module';
import { CoreModule } from '@/modules/core/core.module';
import { ApiController } from '@/modules/main/api.controller';
import { AppController } from '@/modules/main/app.controller';
import { AppService } from '@/modules/main/app.service';
import { ProductModule } from '@/modules/product/product.module';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TypeOrmModuleOptions } from '@nestjs/typeorm/dist/interfaces/typeorm-options.interface';

@Module({
    imports: [
        ConfigModule.forRoot({
            cache: true,
            load: [loadEnv],
            isGlobal: true,
        }),
        TypeOrmModule.forRootAsync({
            imports: [ConfigModule],
            inject: [ConfigService],
            useFactory: async (configService: ConfigService): Promise<TypeOrmModuleOptions> => {
                console.log(`TypeOrmModule.useFactory...`);
                return {
                    type: 'mysql',
                    host: configService.get<string>('DB_HOST'),
                    port: configService.get<number>('DB_PORT'),
                    database: configService.get<string>('DB_NAME'),
                    username: configService.get<string>('DB_USER'),
                    password: configService.get<string>('DB_PASSWORD'),
                    entities: [__dirname + './../**/**.entity{.ts,.js}'],
                    logging: true,
                    synchronize: false,
                } as TypeOrmModuleOptions;
            },
        }),
        // 应用模块
        CommonsModule,
        CoreModule,
        AccountModule,
        AuthModule,
        CatalogModule,
        AttachmentModule,
        AnnouncementModule,
        BannerModule,
        ProductModule,
    ],
    controllers: [AppController, ApiController],
    providers: [AppService, JwtService],
})
export class AppModule {
    constructor() {}
}
