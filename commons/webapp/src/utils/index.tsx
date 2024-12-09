import { setupI18n } from '@commons/core/i18n';
import { RouterConfig, setupRouter } from '@commons/core/router';
import { setDark } from '@commons/core/utils/dark.ts';
import { HttpConfig, setupHttp } from '@commons/core/utils/http';
import { Locale } from '@commons/core/utils/locale.ts';
import { setupDotLottie } from '@commons/core/utils/lottie.ts';
import { defaultTheme, setTheme, Theme, themes, ThemeType } from '@commons/core/utils/theme';
import { theme as AntdTheme, FormItemProps, FormProps, message, ThemeConfig } from 'antd';
import { Locale as AppLocale } from 'antd/es/locale';
import enUsProvider from 'antd/es/locale/en_US';
import zhCnProvider from 'antd/es/locale/zh_CN';
import zhTwProvider from 'antd/es/locale/zh_TW';
import { ItemType } from 'antd/es/menu/interface';
import { isFunction } from 'radash';
import React from 'react';

/**
 * 弹出提示信息
 */
export const toast = async (content: string): Promise<void> => {
    message.info(content);
};

/**
 * 初始化应用
 */
export const setupApp = async (routerConfig?: RouterConfig, initializeApp?: Function): Promise<void> => {
    // 设置国际化
    await setupI18n();
    // 设置路由
    await setupRouter(routerConfig);
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

/**
 * 获取框架语言
 */
export const getAppLocale = (locale: Locale): AppLocale => {
    let appLocale: any;
    switch (locale) {
        case Locale.EN_US:
            appLocale = enUsProvider;
            break;
        case Locale.ZH_TW:
            appLocale = zhTwProvider;
            break;
        default:
            appLocale = zhCnProvider;
    }
    return appLocale;
};

/**
 * 修改主题
 */
export const getAppTheme = (theme: Theme = defaultTheme, dark: boolean = false): ThemeConfig => {
    const t: ThemeType = themes.find((element: ThemeType): boolean => element.theme === theme);
    return {
        token: {
            colorPrimary: t.primaryColor,
        },
        algorithm: dark ? AntdTheme.darkAlgorithm : AntdTheme.defaultAlgorithm,
    };
};

/**
 * 获取框架深色模式
 */
export const setAppDarkMode = (value: boolean): void => {
    setDark(value);
};

/**
 * 设置框架主题
 */
export const setAppTheme = (value: Theme): void => {
    setTheme(value);
};

/**
 * 生成菜单项
 */
export const getItem = (key: React.Key, label: React.ReactNode, icon?: React.ReactNode, children?: ItemType[]): ItemType => {
    if (children && children.length && children.length > 0) {
        return {
            key: key,
            label: label,
            icon: icon,
            children: children,
        } as ItemType;
    } else {
        return {
            key: key,
            label: label,
            icon: icon,
        } as ItemType;
    }
};

/**
 * 默认表单布局
 */
export const defaultFormLayout: FormProps = {
    labelCol: {
        span: 4,
    },
    wrapperCol: {
        span: 16,
    },
    colon: false,
};

export const defaultFormItemLayout: FormItemProps = {
    validateFirst: false,
};
