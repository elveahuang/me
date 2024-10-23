import { RootState, useRootSelector } from '@commons/core/store';
import { antdMobileLocalProvider, setAppDarkMode, setAppTheme } from '@commons/mobile/utils/index.tsx';
import { useMount } from 'ahooks';
import { ConfigProvider } from 'antd-mobile';
import React, { FC, useEffect } from 'react';

export type AntdMobileConfigProviderProps = React.PropsWithChildren<{}>;

export const AntdMobileConfigProvider: FC<AntdMobileConfigProviderProps> = (props: AntdMobileConfigProviderProps) => {
    const { locale, theme, dark } = useRootSelector((state: RootState) => state.app);

    useEffect((): void => {
        setAppDarkMode(dark);
        setAppTheme(theme);
    }, [theme, dark]);

    useMount(async (): Promise<void> => {
        setAppDarkMode(dark);
        setAppTheme(theme);
    });

    return <ConfigProvider locale={antdMobileLocalProvider[locale]}>{props.children}</ConfigProvider>;
};
