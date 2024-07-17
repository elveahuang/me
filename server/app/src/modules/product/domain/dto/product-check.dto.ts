import { EntityKey } from '@/commons/types';
import { IsNotEmpty } from 'class-validator';

export class ProductCheckDto {
    id: EntityKey;
    @IsNotEmpty()
    code: string;
}
