import { SetMetadata } from '@nestjs/common';

/**
 * HasRole
 */
export const HasRole = (...roles: string[]) => SetMetadata('roles', roles);
