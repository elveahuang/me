import { EntityKey } from '@/commons/types';

export class UserSaveDto {
    id: EntityKey;
    username: string;
    displayName: string;
    name: string;
    password: string;
}
