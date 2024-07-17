import { EntityKey } from '@/commons/types';

export class AuthoritySaveDto {
    id: EntityKey;
    username: string;
    password: string;
}
