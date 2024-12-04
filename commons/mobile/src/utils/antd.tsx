import { useAppStore } from '@commons/core/store';
import { AppState } from '@commons/core/store/app.ts';
import { antdMobileLocalProvider, setAppDarkMode, setAppTheme } from '@commons/mobile/utils/index.tsx';
import { useMount } from 'ahooks';
import { ConfigProvider } from 'antd-mobile';
import React, { FC, useEffect } from 'react';

export type AntdMobileConfigProviderProps = React.PropsWithChildren<{}>;

export const AntdMobileConfigProvider: FC<AntdMobileConfigProviderProps> = (props: AntdMobileConfigProviderProps) => {
    const direction = useAppStore((state: AppState) => state.direction);
    const locale = useAppStore((state: AppState) => state.locale);
    const theme = useAppStore((state: AppState) => state.theme);
    const dark = useAppStore((state: AppState) => state.dark);

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
