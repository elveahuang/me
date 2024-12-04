import { initializeApi, InitializeApiResult } from '@commons/core/api';
import { R } from '@commons/core/types';
import { DarkMode, defaultDarkMode } from '@commons/core/utils/dark';
import { defaultDirection, Direction } from '@commons/core/utils/direction';
import { defaultLocale, Locale } from '@commons/core/utils/locale';
import { defaultTheme, Theme } from '@commons/core/utils/theme';
import { create } from 'zustand/react';

export interface AppState {
    /**
     * 名称
     */
    title: string;
    /**
     * 版本号
     */
    version: string;
    /**
     * 页面是否正在加载
     */
    loading: boolean;
    /**
     * 语言
     */
    locale: Locale;
    /**
     * 主题
     */
    theme: Theme;
    /**
     * 对齐方式
     */
    direction: Direction;
    /**
     * 深色模式
     */
    darkMode: DarkMode;
    /**
     * 启用深色模式
     */
    dark: boolean;
    /**
     * 左边导航侧边栏
     */
    sidebar: {
        /**
         * 是否收起
         */
        collapsed: boolean;
        /**
         * 小型化
         */
        mini: boolean;
    };
    /**
     * 右边控制侧边栏
     */
    controlSidebar: {
        /**
         * 是否收起
         */
        collapsed: boolean;
        /**
         * 小型化
         */
        mini: boolean;
    };
    /**
     * 登录相关
     */
    login: {
        /**
         * 是否启用登录验证码
         */
        captcha: boolean;
    };
    /**
     * 应用初始化
     */
    initialize: () => Promise<InitializeApiResult>;
    /**
     * 应用初始化
     */
    changeLocale: (locale: Locale) => void;
    /**
     * 设置深色模式
     */
    setDark: (dark: boolean) => void;
    /**
     * 设置深色模式
     */
    setDarkMode: (darkMode: DarkMode) => void;
    /**
     * 修改主题
     */
    changeTheme: (theme: Theme) => void;
    /**
     * 修改对齐方式
     */
    changeDirection: (direction: Direction) => void;
    /**
     * 切换侧边栏
     */
    toggleSidebar: () => void;
}

export const useAppStore = create<AppState>()((set, get: () => AppState) => ({
    title: '',
    version: '',
    loading: true,
    locale: defaultLocale,
    theme: defaultTheme,
    direction: defaultDirection,
    darkMode: defaultDarkMode,
    dark: false,
    sidebar: {
        collapsed: false,
        mini: false,
    },
    controlSidebar: {
        collapsed: false,
        mini: false,
    },
    login: {
        captcha: false,
    },
    initialize: async (): Promise<InitializeApiResult> => {
        return initializeApi().then((result: R<InitializeApiResult>): R<InitializeApiResult> => {
            return result;
        });
    },
    setDark: (dark: boolean) => set({ dark: dark }),
    setDarkMode: (darkMode: DarkMode) => set({ darkMode: darkMode }),
    changeLocale: (locale: Locale) => set({ locale: locale }),
    changeTheme: (theme: Theme) => set({ theme: theme }),
    changeDirection: (direction: Direction) => set({ direction: direction }),
    toggleSidebar: () => {
        set((state: AppState) => ({
            sidebar: { ...state.sidebar, collapsed: !state.sidebar.collapsed },
        }));
    },
}));
