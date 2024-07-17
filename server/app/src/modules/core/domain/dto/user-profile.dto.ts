import { EntityKey } from '@/commons/types';

export class UserProfileDto {
    id: EntityKey;
    username: string;
    displayName: string;
    name: string;
}
