import { Anonymous } from '@/commons/decorator/anonymous.decorator';
import { DeleteQuery, EntityKey, Page, R } from '@/commons/types';
import { Web } from '@/commons/utils/web';
import { BaseController } from '@/commons/web/base.controller';
import { AnnouncementEntity } from '@/modules/announcement/domain/entity/announcement.entity';
import { BannerListDto } from '@/modules/banner/domain/dto/banner-list.dto';
import { BannerSaveDto } from '@/modules/banner/domain/dto/banner-save.dto';
import { BannerEntity } from '@/modules/banner/domain/entity/banner.entity';
import { BannerService } from '@/modules/banner/service/banner.service';
import { Body, Controller, Param, Post } from '@nestjs/common';
import { ApiOperation } from '@nestjs/swagger';

@Controller('/api/admin/banner')
export class BannerAdminController extends BaseController {
    constructor(private readonly bannerService: BannerService) {
        super();
    }

    @Anonymous()
    @ApiOperation({ summary: '列表' })
    @Post('/list')
    async list(@Body() dto: BannerListDto): Promise<R<Page<BannerEntity>>> {
        return Web.page(await this.bannerService.findByPage(dto));
    }

    @Anonymous()
    @ApiOperation({ summary: '详情' })
    @Post('/view')
    async view(@Param('id') id: EntityKey): Promise<R<AnnouncementEntity>> {
        return Web.success(await this.bannerService.findById(id));
    }

    @Anonymous()
    @Post('/save')
    async save(@Body() dto: BannerSaveDto): Promise<R> {
        this.bannerService.saveBanner(dto).then();
        return Web.success();
    }

    @Anonymous()
    @Post('/delete')
    async delete(@Body() dto: DeleteQuery): Promise<R> {
        this.bannerService.batchSoftDelete(dto).then();
        return Web.success();
    }
}
