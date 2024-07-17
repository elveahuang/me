import { SetMetadata } from '@nestjs/common';

/**
 * HasAuthority
 */
export const HasAuthority = (...authorities: string[]) => SetMetadata('authorities', authorities);
