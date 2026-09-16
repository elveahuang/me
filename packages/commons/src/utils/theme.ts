/**
 * 主题枚举
 */
export enum Theme {
    GRAY = 'gray',
    RED = 'red',
    YELLOW = 'yellow',
    GREEN = 'green',
    BLUE = 'blue',
    PURPLE = 'purple',
}

/**
 * 主题类型
 */
export type ThemeType = {
    theme: Theme;
    title: string;
    label: string;
    primaryColor: string;
    secondaryColor: string;
    tertiaryColor: string;
};

/**
 * 默认主题
 */
export const defaultTheme: Theme = Theme.GREEN;

/**
 * 内置主题
 */
export const themes: ThemeType[] = [
    {
        theme: Theme.GRAY,
        title: 'Gray',
        label: 'common.label_theme_gray',
        primaryColor: '#333',
        secondaryColor: '',
        tertiaryColor: '',
    },
    {
        theme: Theme.RED,
        title: 'Red',
        label: 'common.label_theme_red',
        primaryColor: '#f53f3f',
        secondaryColor: '',
        tertiaryColor: '',
    },
    {
        theme: Theme.YELLOW,
        title: 'Yellow',
        label: 'common.label_theme_yellow',
        primaryColor: '#ffd100',
        secondaryColor: '',
        tertiaryColor: '',
    },
    {
        theme: Theme.GREEN,
        title: 'Green',
        label: 'common.label_theme_green',
        primaryColor: '#25ad30',
        secondaryColor: 'blue',
        tertiaryColor: 'blue',
    },
    {
        theme: Theme.BLUE,
        title: 'Blue',
        label: 'common.label_theme_blue',
        primaryColor: '#2563eb',
        secondaryColor: '',
        tertiaryColor: '',
    },
    {
        theme: Theme.PURPLE,
        title: 'Purple',
        label: 'common.label_theme_purple',
        primaryColor: '#9333ea',
        secondaryColor: '',
        tertiaryColor: '',
    },
];

export const getThemeLabel = (theme: Theme): string => {
    const themeType: ThemeType = themes.find((t: ThemeType): boolean => t.theme === theme);
    if (themeType) {
        return themeType.label;
    }
    return getThemeLabel(defaultTheme);
};

/**
 * 根据语言标识获取语言枚举类型
 */
export const getThemeClassName = (theme: Theme | string): string => {
    return 'app-theme-' + themes.find((t: ThemeType): boolean => t.theme === theme).theme;
};

/**
 * 根据语言标识获取语言枚举类型
 */
export const getTheme = (theme: Theme | string): Theme => {
    const t: ThemeType = themes.find((t: ThemeType): boolean => t.theme === theme);
    if (t) {
        return t.theme;
    }
    return defaultTheme;
};

/**
 * 根据语言标识获取语言枚举类型
 */
export const getThemeType = (theme: Theme | string): ThemeType => {
    return themes.find((t: ThemeType): boolean => t.theme === theme);
};

/**
 * 切换主题
 */
export const setTheme = (theme: Theme = defaultTheme): void => {
    const className: string = getThemeClassName(theme);
    themes.forEach((t: ThemeType): void => {
        document.body.classList.remove(getThemeClassName(t.theme));
    });
    document.body.classList.add(className);
};

/**
 * 设置主题变量
 */
export const setThemeCssVar = (map: Map<string, string> = new Map()): void => {
    if (map.size > 0) {
        map.forEach((value: string, key: string): void => {
            document.body.style.setProperty(key, value);
        });
    }
};

export default themes;
