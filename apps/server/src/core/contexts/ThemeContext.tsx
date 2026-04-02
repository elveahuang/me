'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';

export interface ThemeColors {
    primary: string;
    secondary: string;
    accent: string;
    background: string;
    text: string;
}

export interface DarkModeColors {
    enabled: boolean;
    primary: string;
    background: string;
    text: string;
}

export interface Typography {
    fontFamily: string;
    headingFontFamily: string;
    baseFontSize: number;
    lineHeight: number;
}

export interface Layout {
    containerWidth: string;
    borderRadius: string;
    spacing: string;
}

export interface ThemeConfig {
    colors: ThemeColors;
    darkMode: DarkModeColors;
    typography: Typography;
    layout: Layout;
    isDarkMode: boolean;
}

interface ThemeContextType {
    theme: ThemeConfig;
    toggleDarkMode: () => void;
    setDarkMode: (isDark: boolean) => void;
}

const defaultTheme: ThemeConfig = {
    colors: {
        primary: '#3B82F6',
        secondary: '#6B7280',
        accent: '#10B981',
        background: '#FFFFFF',
        text: '#1F2937',
    },
    darkMode: {
        enabled: true,
        primary: '#60A5FA',
        background: '#111827',
        text: '#F9FAFB',
    },
    typography: {
        fontFamily: 'inter',
        headingFontFamily: 'inter',
        baseFontSize: 16,
        lineHeight: 1.6,
    },
    layout: {
        containerWidth: '1200',
        borderRadius: 'medium',
        spacing: 'normal',
    },
    isDarkMode: false,
};

const ThemeContext = createContext<ThemeContextType>({
    theme: defaultTheme,
    toggleDarkMode: () => {},
    setDarkMode: () => {},
});

export function ThemeProvider({ children, initialTheme }: { children: React.ReactNode; initialTheme?: Partial<ThemeConfig> }) {
    const [isDarkMode, setIsDarkMode] = useState(false);

    const theme: ThemeConfig = {
        ...defaultTheme,
        ...initialTheme,
        isDarkMode,
    };

    useEffect(() => {
        const savedMode = localStorage.getItem('darkMode');
        if (savedMode !== null) {
            setIsDarkMode(savedMode === 'true');
        } else if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
            setIsDarkMode(true);
        }
    }, []);

    useEffect(() => {
        const root = document.documentElement;

        const activeColors =
            isDarkMode && theme.darkMode.enabled
                ? {
                      primary: theme.darkMode.primary,
                      background: theme.darkMode.background,
                      text: theme.darkMode.text,
                  }
                : {
                      primary: theme.colors.primary,
                      background: theme.colors.background,
                      text: theme.colors.text,
                  };

        root.style.setProperty('--color-primary', activeColors.primary);
        root.style.setProperty('--color-secondary', theme.colors.secondary);
        root.style.setProperty('--color-accent', theme.colors.accent);
        root.style.setProperty('--color-background', activeColors.background);
        root.style.setProperty('--color-text', activeColors.text);
        root.style.setProperty('--font-family', `var(--font-${theme.typography.fontFamily})`);
        root.style.setProperty('--font-heading', `var(--font-${theme.typography.headingFontFamily})`);
        root.style.setProperty('--font-size-base', `${theme.typography.baseFontSize}px`);
        root.style.setProperty('--line-height', String(theme.typography.lineHeight));

        const borderRadiusMap: Record<string, string> = {
            none: '0',
            small: '0.25rem',
            medium: '0.5rem',
            large: '1rem',
            full: '9999px',
        };
        root.style.setProperty('--border-radius', borderRadiusMap[theme.layout.borderRadius] || '0.5rem');

        if (isDarkMode) {
            document.documentElement.classList.add('dark');
        } else {
            document.documentElement.classList.remove('dark');
        }
    }, [isDarkMode, theme]);

    const toggleDarkMode = () => {
        const newMode = !isDarkMode;
        setIsDarkMode(newMode);
        localStorage.setItem('darkMode', String(newMode));
    };

    const setDarkMode = (isDark: boolean) => {
        setIsDarkMode(isDark);
        localStorage.setItem('darkMode', String(isDark));
    };

    return <ThemeContext.Provider value={{ theme, toggleDarkMode, setDarkMode }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
    const context = useContext(ThemeContext);
    if (!context) {
        throw new Error('useTheme must be used within a ThemeProvider');
    }
    return context;
}
