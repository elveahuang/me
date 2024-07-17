import { CommonsModule } from '@/commons/commons.module';
import { createCustomRepository } from '@/commons/utils';
import { AuthModule } from '@/modules/auth/auth.module';
import { BannerAdminController } from '@/modules/banner/controller/banner.admin.controller';
import { BannerAppController } from '@/modules/banner/controller/banner.app.controller';
import { BannerEntity } from '@/modules/banner/domain/entity/banner.entity';
import { BannerRepositoryImpl } from '@/modules/banner/repository/banner.repository';
import { BannerService } from '@/modules/banner/service/banner.service';
import { CoreModule } from '@/modules/core/core.module';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

@Module({
    imports: [TypeOrmModule.forFeature([BannerEntity]), CommonsModule, CoreModule, AuthModule],
    providers: [createCustomRepository(BannerEntity, BannerRepositoryImpl), BannerService],
    controllers: [BannerAdminController, BannerAppController],
    exports: [BannerService],
})
export class BannerModule {}
