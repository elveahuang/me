import React, { FC, PropsWithChildren, Suspense } from 'react';
import { Outlet } from 'react-router';

export type MainLayoutProps = React.PropsWithChildren<{ layoutClassName?: string }>;

const MainLayout: FC<MainLayoutProps> = (props: PropsWithChildren<MainLayoutProps>) => {
    return (
        <Suspense>
            <Outlet />
        </Suspense>
    );
};

export default MainLayout;
