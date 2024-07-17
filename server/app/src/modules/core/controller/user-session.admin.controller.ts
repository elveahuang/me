import { UserSessionEntity } from '@/modules/core/domain/entity/user-session.entity';
import { UserSessionService } from '@/modules/core/service/user-session.service';
import { Controller, Get } from '@nestjs/common';

@Controller('/api/admin/user-session')
export class UserSessionAdminController {
    constructor(private readonly userSessionService: UserSessionService) {}

    @Get('/list')
    async list(): Promise<UserSessionEntity[]> {
        return await this.userSessionService.findAll();
    }
}
