import { Principal } from '@/commons/security/principal';
import { createParamDecorator } from '@nestjs/common';

/**
 * User
 */
export const User = createParamDecorator((data, req): Principal => {
    console.log('PrincipalParamDecorator...');
    return req.principal;
});
