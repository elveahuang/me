import { Anonymous } from '@/commons/decorator/anonymous.decorator';
import { DeleteQuery, EntityKey, Page, R } from '@/commons/types';
import { Web } from '@/commons/utils/web';
import { BaseController } from '@/commons/web/base.controller';
import { AnnouncementListDto } from '@/modules/announcement/domain/dto/announcement-list.dto';
import { AnnouncementSaveDto } from '@/modules/announcement/domain/dto/announcement-save.dto';
import { AnnouncementEntity } from '@/modules/announcement/domain/entity/announcement.entity';
import { AnnouncementService } from '@/modules/announcement/service/announcement.service';
import { Body, Controller, Post } from '@nestjs/common';
import { ApiOperation } from '@nestjs/swagger';

@Controller('/api/admin/announcement')
export class AnnouncementAdminController extends BaseController {
    constructor(private readonly announcementService: AnnouncementService) {
        super();
    }

    @Anonymous()
    @ApiOperation({ summary: '资讯列表' })
    @Post('/list')
    async list(@Body() dto: AnnouncementListDto): Promise<R<Page<AnnouncementEntity>>> {
        return Web.page(await this.announcementService.findByPage(dto));
    }

    @Anonymous()
    @ApiOperation({ summary: '资讯详情' })
    @Post('/details')
    async details(@Body('id') id: EntityKey): Promise<R<AnnouncementEntity>> {
        return Web.success(await this.announcementService.findById(id));
    }

    @Anonymous()
    @Post('/save')
    async save(@Body() dto: AnnouncementSaveDto): Promise<R> {
        this.announcementService.saveAnnouncement(dto).then();
        return Web.success();
    }

    @Anonymous()
    @Post('/delete')
    async delete(@Body() dto: DeleteQuery): Promise<R> {
        this.announcementService.batchSoftDelete(dto).then();
        return Web.success();
    }
}
