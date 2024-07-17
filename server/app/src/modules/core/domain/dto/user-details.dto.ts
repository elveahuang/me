import { EntityKey } from '@/commons/types';

export class UserDetailsDto {
    id: EntityKey;
    username: string;
    displayName: string;
    name: string;
    status: number;
}
