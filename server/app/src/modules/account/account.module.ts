import { CommonsModule } from '@/commons/commons.module';
import { AuthModule } from '@/modules/auth/auth.module';
import { CoreModule } from '@/modules/core/core.module';
import { Module } from '@nestjs/common';

@Module({
    imports: [CommonsModule, CoreModule, AuthModule],
    controllers: [],
    providers: [],
})
export class AccountModule {
    constructor() {}
}
