import { EntityKey } from '@/commons/types';

export class AnnouncementSaveDto {
    id: EntityKey;
    title: string;
    content: string;
}
