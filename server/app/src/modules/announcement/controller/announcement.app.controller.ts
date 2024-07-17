import { Anonymous } from '@/commons/decorator/anonymous.decorator';
import { EntityKey, R } from '@/commons/types';
import { Web } from '@/commons/utils/web';
import { BaseController } from '@/commons/web/base.controller';
import { AnnouncementEntity } from '@/modules/announcement/domain/entity/announcement.entity';
import { AnnouncementService } from '@/modules/announcement/service/announcement.service';
import { AttachmentFileUploadDto } from '@/modules/attachment/domain/dto/attachment-file-upload.dto';
import { Body, Controller, Param, Post } from '@nestjs/common';

@Controller('/api/announcement')
export class AnnouncementAppController extends BaseController {
    constructor(private readonly announcementService: AnnouncementService) {
        super();
    }

    @Anonymous()
    @Post('/upload')
    async list(@Body() dto: AttachmentFileUploadDto): Promise<R> {
        return Web.success();
    }

    @Anonymous()
    @Post('/view')
    async view(@Param('id') id: EntityKey): Promise<R<AnnouncementEntity>> {
        return Web.success(await this.announcementService.findById(id));
    }
}
