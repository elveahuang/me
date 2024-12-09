import { useRootSelector } from '@commons/core/store';
import { isAuthenticated } from '@commons/core/store/user';
import { log } from '@commons/core/utils';
import { hasAuthority } from '@commons/core/utils/auth';
import React, { FC } from 'react';
import { Navigate } from 'react-router';

export interface AuthorizeRouteProps {
    name?: string;
    authority?: string | string[];
    element?: React.ReactNode;
}

const AuthorizeRoute: FC<AuthorizeRouteProps> = (props: AuthorizeRouteProps) => {
    const { name, authority, element } = props;
    const { user } = useRootSelector((state) => state.user);
    const result = authority === undefined ? isAuthenticated : hasAuthority(authority, user?.authorities);
    if (authority === undefined) {
        log(`AuthorizeRoute name [${name}] - check result - [${result}].`);
    } else {
        log(`AuthorizeRoute name [${name}] authority [${authority}] - check result - [${result}].`);
    }
    return result ? <>{element}</> : <Navigate to="/login" replace={true} />;
};

export default AuthorizeRoute;
