import { RootState, useRootSelector } from '@commons/core/store';
import { getAppLocale, getAppTheme, setAppDarkMode, setAppTheme } from '@commons/webapp/utils/index.tsx';
import { useMount } from 'ahooks';
import { App, ConfigProvider, ThemeConfig } from 'antd';
import { Locale as AppLocale } from 'antd/es/locale';
import React, { FC, useEffect, useState } from 'react';

export const AntdConfigProvider: FC<React.PropsWithChildren<{}>> = (props: React.PropsWithChildren<{}>) => {
    const { direction, locale, theme, dark } = useRootSelector((state: RootState) => state.app);
    const [themeConfig, setThemeConfig] = useState<ThemeConfig>(getAppTheme(theme));
    const [localeConfig, setLocaleConfig] = useState<AppLocale>(getAppLocale(locale));

    useEffect((): void => {
        setThemeConfig(getAppTheme(theme, dark));
        setAppDarkMode(dark);
        setAppTheme(theme);
    }, [theme, dark]);

    useEffect((): void => {
        setLocaleConfig(getAppLocale(locale));
    }, [locale]);

    useMount(async (): Promise<void> => {
        setAppDarkMode(dark);
        setAppTheme(theme);
    });

    return (
        <ConfigProvider theme={themeConfig} direction={direction} locale={localeConfig}>
            <App className="app-container">{props.children}</App>
        </ConfigProvider>
    );
};
