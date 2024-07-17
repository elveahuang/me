import { Anonymous } from '@/commons/decorator/anonymous.decorator';
import { Page, R } from '@/commons/types';
import { Web } from '@/commons/utils/web';
import { AnnouncementListDto } from '@/modules/announcement/domain/dto/announcement-list.dto';
import { UserCheckDto } from '@/modules/core/domain/dto/user-check.dto';
import { UserProfileDto } from '@/modules/core/domain/dto/user-profile.dto';
import { UserRegisterDto } from '@/modules/core/domain/dto/user-register.dto';
import { UserEntity } from '@/modules/core/domain/entity/user.entity';
import { UserService } from '@/modules/core/service/user.service';
import { Body, Controller, Get, Post } from '@nestjs/common';

@Controller('/api/user')
export class UserAppController {
    constructor(private readonly userService: UserService) {}

    @Anonymous()
    @Post('/check/username')
    async check(@Body() dto: UserCheckDto): Promise<R<boolean>> {
        return Web.success(await this.userService.checkUsername(dto));
    }

    @Get('/list')
    async list(@Body() dto: AnnouncementListDto): Promise<R<Page<UserEntity>>> {
        return Web.page(await this.userService.findByPage(dto));
    }

    @Get('/register')
    async register(@Body() dto: UserRegisterDto): Promise<R> {
        return Web.success(await this.userService.register(dto));
    }

    @Get('/profile')
    async profile(): Promise<R<UserProfileDto>> {
        return Web.success();
    }
}
