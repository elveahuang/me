import { CommonsModule } from '@/commons/commons.module';
import { createCustomRepository } from '@/commons/utils';
import { AnnouncementAdminController } from '@/modules/announcement/controller/announcement.admin.controller';
import { AnnouncementAppController } from '@/modules/announcement/controller/announcement.app.controller';
import { AnnouncementEntity } from '@/modules/announcement/domain/entity/announcement.entity';
import { AnnouncementRepositoryImpl } from '@/modules/announcement/repository/announcement.repository';
import { AnnouncementService } from '@/modules/announcement/service/announcement.service';
import { AuthModule } from '@/modules/auth/auth.module';
import { CoreModule } from '@/modules/core/core.module';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

@Module({
    imports: [TypeOrmModule.forFeature([AnnouncementEntity]), CommonsModule, CoreModule, AuthModule],
    providers: [createCustomRepository(AnnouncementEntity, AnnouncementRepositoryImpl), AnnouncementService],
    controllers: [AnnouncementAdminController, AnnouncementAppController],
    exports: [AnnouncementService],
})
export class AnnouncementModule {}
