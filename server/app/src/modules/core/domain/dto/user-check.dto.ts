import { EntityKey } from '@/commons/types';
import { IsNotEmpty } from 'class-validator';

export class UserCheckDto {
    id: EntityKey;

    @IsNotEmpty()
    username: string;
}
