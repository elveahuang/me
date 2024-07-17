import { Anonymous } from '@/commons/decorator/anonymous.decorator';
import { DeleteQuery, EntityKey, Page, R } from '@/commons/types';
import { Web } from '@/commons/utils/web';
import { BaseController } from '@/commons/web/base.controller';
import { AuthorityListDto } from '@/modules/core/domain/dto/authority-list.dto';
import { AuthoritySaveDto } from '@/modules/core/domain/dto/authority-save.dto';
import { AuthorityEntity } from '@/modules/core/domain/entity/authority.entity';
import { RoleEntity } from '@/modules/core/domain/entity/role.entity';
import { AuthorityService } from '@/modules/core/service/authority.service';
import { Body, Controller, Param, Post } from '@nestjs/common';
import { ApiOperation } from '@nestjs/swagger';

@Controller('/api/admin/authority')
export class AuthorityAdminController extends BaseController {
    constructor(private readonly authorityService: AuthorityService) {
        super();
    }

    @Anonymous()
    @ApiOperation({ summary: '列表' })
    @Post('/list')
    async list(@Body() dto: AuthorityListDto): Promise<R<Page<AuthorityEntity>>> {
        return Web.page(await this.authorityService.findByPage(dto));
    }

    @Anonymous()
    @ApiOperation({ summary: '资讯详情' })
    @Post('/view')
    async view(@Param('id') id: EntityKey): Promise<R<RoleEntity>> {
        return Web.success(await this.authorityService.findById(id));
    }

    @Anonymous()
    @Post('/save')
    async save(@Body() dto: AuthoritySaveDto): Promise<R> {
        this.authorityService.saveAuthority(dto).then();
        return Web.success();
    }

    @Anonymous()
    @Post('/delete')
    async delete(@Body() dto: DeleteQuery): Promise<R> {
        this.authorityService.batchSoftDelete(dto).then();
        return Web.success();
    }
}
