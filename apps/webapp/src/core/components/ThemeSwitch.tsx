'use client';

import { useTheme } from '@/core/contexts/ThemeContext';

interface ThemeSwitchProps {
    className?: string;
}

export function ThemeSwitch({ className = '' }: ThemeSwitchProps) {
    const { isDarkMode, toggleDarkMode } = useTheme();

    return (
        <button
            onClick={toggleDarkMode}
            className={`rounded-lg p-2 transition-colors hover:bg-gray-100 dark:hover:bg-gray-800 ${className}`}
            aria-label={isDarkMode ? '切换到亮色模式' : '切换到暗色模式'}
        >
            {isDarkMode ? (
                <svg className='h-5 w-5 text-yellow-500' fill='none' viewBox='0 0 24 24' stroke='currentColor'>
                    <path
                        strokeLinecap='round'
                        strokeLinejoin='round'
                        strokeWidth={2}
                        d='M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z'
                    />
                </svg>
            ) : (
                <svg className='h-5 w-5 text-gray-700' fill='none' viewBox='0 0 24 24' stroke='currentColor'>
                    <path
                        strokeLinecap='round'
                        strokeLinejoin='round'
                        strokeWidth={2}
                        d='M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z'
                    />
                </svg>
            )}
        </button>
    );
}
