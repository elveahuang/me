import { EntityKey } from '@/commons/types';

export class ProductDetailsDto {
    id: EntityKey;
    code: string;
    title: string;
    content: string;
}
