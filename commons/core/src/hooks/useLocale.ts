import { setI18nextLocale, setI18nextMessages } from '@commons/core/i18n';
import { useAppStore } from '@commons/core/store';
import { AppState } from '@commons/core/store/app.ts';
import { Locale } from '@commons/core/utils/locale';

const useLocale = (): {
    changeLocale: (locale: Locale) => Promise<void>;
} => {
    return {
        changeLocale: async (locale: Locale): Promise<void> => {
            const changeLocale = useAppStore((state: AppState) => state.changeLocale);
            changeLocale(locale);
            await setI18nextMessages(locale);
            await setI18nextLocale(locale);
        },
    };
};

export default useLocale;
