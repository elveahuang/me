import { useRootSelector } from '@commons/core/store';
import { isAuthenticated } from '@commons/core/store/user.ts';
import { log } from '@commons/core/utils';
import { hasAuthority } from '@commons/core/utils/auth';
import { isUndefined } from 'lodash-es';
import React, { FC } from 'react';
import { Navigate } from 'react-router-dom';

export interface AuthorizeProps {
    authority?: string | string[];
    children: React.ReactNode;
    noMatch: React.ReactNode | string;
}

const Authorize: FC<AuthorizeProps> = (props: AuthorizeProps) => {
    const { children, authority, noMatch = <Navigate to={'/403'} /> } = props;
    const { user } = useRootSelector((state) => state.user);
    const render = typeof children === 'undefined' ? null : children;
    const result = isUndefined(authority) ? isAuthenticated : hasAuthority(authority, user?.authorities);
    if (isUndefined(authority)) {
        log(`Authorize check result - [${result}].`);
    } else {
        log(`Authorize authority [${authority}] - check result - [${result}].`);
    }
    return <>{result ? render : noMatch}</>;
};

export default Authorize;
