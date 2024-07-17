import { Anonymous } from '@/commons/decorator/anonymous.decorator';
import { BaseController } from '@/commons/web/base.controller';
import { Controller, Get } from '@nestjs/common';

@Controller('/api/')
export class ApiController extends BaseController {
    constructor() {
        super();
    }

    @Anonymous()
    @Get('/initialize')
    index(): string | bigint | unknown {
        return { message: 'Hello world!' };
    }
}
