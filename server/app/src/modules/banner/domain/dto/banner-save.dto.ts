import { EntityKey } from '@/commons/types';

export class BannerSaveDto {
    id: EntityKey;
    title: string;
    content: string;
}
