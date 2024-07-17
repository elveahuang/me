import { createCustomRepository } from '@/commons/utils';
import { AuthorityAdminController } from '@/modules/core/controller/authority.admin.controller';
import { AuthorityAppController } from '@/modules/core/controller/authority.app.controller';
import { DashboardAdminController } from '@/modules/core/controller/dashboard.admin.controller';
import { RoleAdminController } from '@/modules/core/controller/role.admin.controller';
import { RoleAppController } from '@/modules/core/controller/role.app.controller';
import { UserSessionAdminController } from '@/modules/core/controller/user-session.admin.controller';
import { UserAdminController } from '@/modules/core/controller/user.admin.controller';
import { UserAppController } from '@/modules/core/controller/user.app.controller';
import { AuthorityEntity } from '@/modules/core/domain/entity/authority.entity';
import { ConfigEntity } from '@/modules/core/domain/entity/config.entity';
import { LangEntity } from '@/modules/core/domain/entity/lang.entity';
import { RoleAuthorityEntity } from '@/modules/core/domain/entity/role-authority.entity';
import { RoleEntity } from '@/modules/core/domain/entity/role.entity';
import { UserRoleEntity } from '@/modules/core/domain/entity/user-role.entity';
import { UserSessionEntity } from '@/modules/core/domain/entity/user-session.entity';
import { UserEntity } from '@/modules/core/domain/entity/user.entity';
import { AuthorityRepositoryImpl } from '@/modules/core/repository/authority.repository';
import { ConfigRepositoryImpl } from '@/modules/core/repository/config.repository';
import { LangRepositoryImpl } from '@/modules/core/repository/lang.repository';
import { RoleAuthorityRepositoryImpl } from '@/modules/core/repository/role-authority.repository';
import { RoleRepositoryImpl } from '@/modules/core/repository/role.repository';
import { UserRoleRepositoryImpl } from '@/modules/core/repository/user-role.repository';
import { UserSessionRepositoryImpl } from '@/modules/core/repository/user-session.repository';
import { UserRepositoryImpl } from '@/modules/core/repository/user.repository';
import { AuthorityService } from '@/modules/core/service/authority.service';
import { RoleService } from '@/modules/core/service/role.service';
import { UserSessionService } from '@/modules/core/service/user-session.service';
import { UserService } from '@/modules/core/service/user.service';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

@Module({
    imports: [TypeOrmModule.forFeature([UserEntity, UserSessionEntity, RoleEntity, AuthorityEntity, UserRoleEntity, RoleAuthorityEntity])],
    providers: [
        createCustomRepository(UserEntity, UserRepositoryImpl),
        createCustomRepository(UserSessionEntity, UserSessionRepositoryImpl),
        createCustomRepository(RoleEntity, RoleRepositoryImpl),
        createCustomRepository(AuthorityEntity, AuthorityRepositoryImpl),
        createCustomRepository(UserRoleEntity, UserRoleRepositoryImpl),
        createCustomRepository(RoleAuthorityEntity, RoleAuthorityRepositoryImpl),
        createCustomRepository(ConfigEntity, ConfigRepositoryImpl),
        createCustomRepository(LangEntity, LangRepositoryImpl),
        UserService,
        UserSessionService,
        RoleService,
        AuthorityService,
    ],
    exports: [TypeOrmModule, UserService, UserSessionService, RoleService, AuthorityService],
    controllers: [
        RoleAppController,
        UserAppController,
        AuthorityAppController,
        AuthorityAdminController,
        DashboardAdminController,
        RoleAdminController,
        UserAdminController,
        UserSessionAdminController,
    ],
})
export class CoreModule {}
