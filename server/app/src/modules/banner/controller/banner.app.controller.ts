import { Anonymous } from '@/commons/decorator/anonymous.decorator';
import { EntityKey, Page, R } from '@/commons/types';
import { Web } from '@/commons/utils/web';
import { BannerListDto } from '@/modules/banner/domain/dto/banner-list.dto';
import { BannerEntity } from '@/modules/banner/domain/entity/banner.entity';
import { BannerService } from '@/modules/banner/service/banner.service';
import { Body, Controller, Param, Post } from '@nestjs/common';

@Controller('/api/banner')
export class BannerAppController {
    constructor(private readonly bannerService: BannerService) {}

    @Anonymous()
    @Post('/list')
    async list(@Body() query: BannerListDto): Promise<R<Page<BannerEntity>>> {
        return Web.page(await this.bannerService.findByPage(query));
    }

    @Anonymous()
    @Post('/view')
    async view(@Param('id') id: EntityKey): Promise<R<BannerEntity>> {
        return Web.success(await this.bannerService.findById(id));
    }
}
