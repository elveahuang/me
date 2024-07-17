import { Anonymous } from '@/commons/decorator/anonymous.decorator';
import { DeleteQuery, EntityKey, Page, R } from '@/commons/types';
import { Web } from '@/commons/utils/web';
import { BaseController } from '@/commons/web/base.controller';
import { RoleListDto } from '@/modules/core/domain/dto/role-list.dto';
import { RoleSaveDto } from '@/modules/core/domain/dto/role-save.dto';
import { RoleEntity } from '@/modules/core/domain/entity/role.entity';
import { RoleService } from '@/modules/core/service/role.service';
import { Body, Controller, Param, Post } from '@nestjs/common';
import { ApiOperation } from '@nestjs/swagger';

@Controller('/api/admin/role')
export class RoleAdminController extends BaseController {
    constructor(private readonly roleService: RoleService) {
        super();
    }

    @Anonymous()
    @ApiOperation({ summary: '列表' })
    @Post('/list')
    async list(@Body() dto: RoleListDto): Promise<R<Page<RoleEntity>>> {
        return Web.page(await this.roleService.findByPage(dto));
    }

    @Anonymous()
    @ApiOperation({ summary: '资讯详情' })
    @Post('/view')
    async view(@Param('id') id: EntityKey): Promise<R<RoleEntity>> {
        return Web.success(await this.roleService.findById(id));
    }

    @Anonymous()
    @Post('/save')
    async save(@Body() dto: RoleSaveDto): Promise<R> {
        this.roleService.saveRole(dto).then();
        return Web.success();
    }

    @Anonymous()
    @Post('/delete')
    async delete(@Body() dto: DeleteQuery): Promise<R> {
        this.roleService.batchSoftDelete(dto).then();
        return Web.success();
    }
}
