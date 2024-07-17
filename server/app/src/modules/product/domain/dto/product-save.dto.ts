import { EntityKey } from '@/commons/types';

export class ProductSaveDto {
    id: EntityKey;
    code: string;
    title: string;
    content: string;
}
