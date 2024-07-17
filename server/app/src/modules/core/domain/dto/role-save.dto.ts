import { EntityKey } from '@/commons/types';

export class RoleSaveDto {
    id: EntityKey;
    username: string;
    password: string;
}
