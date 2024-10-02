import { log } from '@commons/core/utils';
import { DarkMode, defaultDarkMode } from '@commons/core/utils/dark';
import { Direction, defaultDirection } from '@commons/core/utils/direction';
import { Locale, defaultLocale } from '@commons/core/utils/locale';
import { Theme, defaultTheme, setTheme } from '@commons/core/utils/theme';
import { PayloadAction, createSlice } from '@reduxjs/toolkit';

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
}

export const initialState: AppState = {
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
};

export const appSlice = createSlice({
    name: 'app',
    initialState: initialState,
    reducers: {
        /**
         * 初始化
         */
        initialize: (state: AppState) => {
            log(`Store app initialize.`);
            return state;
        },
        /**
         * 切换语言
         */
        changeLocale: (state: AppState, action: PayloadAction<Locale>) => {
            return { ...state, locale: action.payload };
        },
        /**
         * 切换语言
         */
        setDarkMode: (state: AppState, action: PayloadAction<DarkMode>) => {
            return { ...state, darkMode: action.payload };
        },
        /**
         * 切换语言
         */
        setDark: (state: AppState, action: PayloadAction<boolean>) => {
            return { ...state, dark: action.payload };
        },
        /**
         * 切换主题
         */
        changeTheme: (state: AppState, action: PayloadAction<Theme>) => {
            setTheme(action.payload);
            return { ...state, theme: action.payload };
        },
        /**
         * 切换对其方式
         */
        changeDirection: (state: AppState, action: PayloadAction<Direction>) => {
            return { ...state, direction: action.payload };
        },
        /**
         * 切换侧边导航栏
         */
        toggleSidebar: (state: AppState) => {
            state.sidebar.collapsed = !state.sidebar.collapsed;
            return state;
        },
    },
});

export const { initialize, toggleSidebar, setDarkMode, setDark, changeLocale, changeTheme, changeDirection } = appSlice.actions;

export default appSlice.reducer;
