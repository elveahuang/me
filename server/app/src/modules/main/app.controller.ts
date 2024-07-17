import { Context } from '@/commons/decorator/context.decorator';
import { SequenceService } from '@/commons/service/sequence.service';
import { BaseController } from '@/commons/web/base.controller';
import { RequestContext } from '@/commons/web/request-context';
import { AppService } from '@/modules/main/app.service';
import { Controller, Get, Render } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Controller()
export class AppController extends BaseController {
    constructor(
        private readonly configService: ConfigService,
        private readonly sequenceService: SequenceService,
        private readonly appService: AppService,
    ) {
        super();
    }

    /**
     * 首页
     */
    @Get()
    @Render('index.hbs')
    index(@Context() context: RequestContext): string | bigint | unknown {
        console.log(this.configService.get<string>('JWT_SECRET'));
        console.log(this.sequenceService.nextId().toString());
        return { message: 'Hello world!' };
    }
}
