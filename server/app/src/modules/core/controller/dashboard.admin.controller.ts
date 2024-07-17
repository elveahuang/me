import { Anonymous } from '@/commons/decorator/anonymous.decorator';
import { BaseController } from '@/commons/web/base.controller';
import { Controller, Get } from '@nestjs/common';

@Controller('/api/admin')
export class DashboardAdminController extends BaseController {
    constructor() {
        super();
    }

    @Anonymous()
    @Get('/dashboard')
    dashboard(): string | bigint | unknown {
        return { message: 'Hello world!' };
    }

    @Anonymous()
    @Get('/workbench')
    workbench(): string | bigint | unknown {
        return { message: 'Hello world!' };
    }
}
