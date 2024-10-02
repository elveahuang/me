import { store } from '@commons/core/store';
import { setDark, setDarkMode } from '@commons/core/store/app';
import { DarkMode, getDarkValue } from '@commons/core/utils/dark.ts';

const useDark = (): {
    setDark: (dark: boolean) => Promise<void>;
    setDarkMode: (darkMode: DarkMode) => Promise<void>;
} => {
    return {
        setDarkMode: async (mode: DarkMode): Promise<void> => {
            store.dispatch(setDarkMode(mode));
            store.dispatch(setDark(getDarkValue(mode)));
        },
        setDark: async (dark: boolean): Promise<void> => {
            store.dispatch(setDark(dark));
        },
    };
};

export default useDark;
