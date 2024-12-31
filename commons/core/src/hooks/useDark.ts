import { useAppStore } from '@commons/core/store';
import { AppState } from '@commons/core/store/app';
import { DarkMode, getDarkValue } from '@commons/core/utils/dark.ts';

const useDark = (): {
    setDark: (dark: boolean) => Promise<void>;
    setDarkMode: (darkMode: DarkMode) => Promise<void>;
} => {
    return {
        setDarkMode: async (mode: DarkMode): Promise<void> => {
            const setDarkMode = useAppStore((state: AppState) => state.setDarkMode);
            const setDark = useAppStore((state: AppState) => state.setDark);
            setDarkMode(mode);
            setDark(getDarkValue(mode));
        },
        setDark: async (dark: boolean): Promise<void> => {
            const setDark = useAppStore((state: AppState) => state.setDark);
            setDark(dark);
        },
    };
};

export default useDark;
