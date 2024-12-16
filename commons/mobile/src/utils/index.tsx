import { setupI18n } from '@commons/core/i18n';
import { RouterConfig, setupRouter } from '@commons/core/router';
import { setDark } from '@commons/core/utils/dark';
import { HttpConfig, setupHttp } from '@commons/core/utils/http';
import { Locale } from '@commons/core/utils/locale';
import { setupDotLottie } from '@commons/core/utils/lottie.ts';
import { getThemeType, setTheme, setThemeCssVar, Theme, ThemeType } from '@commons/core/utils/theme';
import { Toast } from 'antd-mobile';
import enUsProvider from 'antd-mobile/es/locales/en-US';
import zhCnProvider from 'antd-mobile/es/locales/zh-CN';
import zhTwProvider from 'antd-mobile/es/locales/zh-TW';
import { isFunction } from 'radash';

/**
 * 弹出提示信息
 */
export const toast = async (content: string): Promise<void> => {
    Toast.show({
        content: content,
    });
};

export const setupApp = async (routerConfig?: RouterConfig, initializeApp?: Function): Promise<void> => {
    // 设置路由
    await setupRouter(routerConfig);
    // 设置国际化
    await setupI18n();
    // 设置网络请求
    await setupHttp({
        toast: toast,
        excludes: ['/oauth/token'],
    } as HttpConfig);
    // 设置动效
    await setupDotLottie().then();
    // 自定义初始化函数
    if (isFunction(initializeApp)) {
        await initializeApp().then();
    }
};

export const antdMobileLocalProvider: Record<Locale, any> = {
    [Locale.ZH_CN]: zhCnProvider,
    [Locale.ZH_TW]: zhTwProvider,
    [Locale.EN_US]: enUsProvider,
};

/**
 * 获取深色模式
 */
export const setAppDarkMode = (value: boolean): void => {
    // 设置深色模式
    setDark(value);
    // 设置框架深色模式
    document.documentElement.setAttribute('data-prefers-color-scheme', value ? 'dark' : 'light');
};

/**
 * 设置主题
 */
export const setAppTheme = (value: Theme): void => {
    // 设置主题
    setTheme(value);
    // 设置框架主题
    const themeType: ThemeType = getThemeType(value);
    const map: Map<string, string> = new Map();
    map.set('--adm-color-primary', themeType.primaryColor);
    setThemeCssVar(map);
};
