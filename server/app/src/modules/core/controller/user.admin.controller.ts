import { Anonymous } from '@/commons/decorator/anonymous.decorator';
import { DeleteQuery, EntityKey, Page, R } from '@/commons/types';
import { toPage } from '@/commons/utils';
import { Web } from '@/commons/utils/web';
import { BaseController } from '@/commons/web/base.controller';
import { UserCheckDto } from '@/modules/core/domain/dto/user-check.dto';
import { UserDetailsDto } from '@/modules/core/domain/dto/user-details.dto';
import { UserListDto } from '@/modules/core/domain/dto/user-list.dto';
import { UserSaveDto } from '@/modules/core/domain/dto/user-save.dto';
import { UserEntity } from '@/modules/core/domain/entity/user.entity';
import { UserService } from '@/modules/core/service/user.service';
import { Body, Controller, Post } from '@nestjs/common';
import { ApiOperation } from '@nestjs/swagger';

@Controller('/api/admin/user')
export class UserAdminController extends BaseController {
    constructor(private readonly userService: UserService) {
        super();
    }

    @Anonymous()
    @Post('/check')
    async check(@Body() dto: UserCheckDto): Promise<R<boolean>> {
        return Web.success(await this.userService.checkUsername(dto));
    }

    @Anonymous()
    @ApiOperation({ summary: '用户列表' })
    @Post('/list')
    async list(@Body() pagination: UserListDto): Promise<R<Page<UserDetailsDto>>> {
        const [items, total]: [UserEntity[], number] = await this.userService.search(pagination);
        const page: Page<UserDetailsDto> = toPage(
            items?.map((item: UserEntity) => this.userService.toDetailsDto(item)),
            total,
            pagination,
        );
        return Web.page(page);
    }

    @Anonymous()
    @ApiOperation({ summary: '用户详情' })
    @Post('/details')
    async details(@Body('id') id: EntityKey): Promise<R<UserDetailsDto>> {
        const entity: UserEntity = await this.userService.findById(id);
        return Web.success(this.userService.toDetailsDto(entity));
    }

    @Anonymous()
    @Post('/save')
    async save(@Body() dto: UserSaveDto): Promise<R> {
        this.userService.saveUser(dto).then();
        return Web.success();
    }

    @Anonymous()
    @Post('/delete')
    async delete(@Body() dto: DeleteQuery): Promise<R> {
        this.userService.batchSoftDelete(dto).then();
        return Web.success();
    }
}
