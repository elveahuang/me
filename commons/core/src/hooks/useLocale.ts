import { setI18nextLocale, setI18nextMessages } from '@commons/core/i18n';
import { store } from '@commons/core/store';
import { changeLocale } from '@commons/core/store/app';
import { Locale } from '@commons/core/utils/locale';

const useLocale = (): {
    changeLocale: (locale: Locale) => Promise<void>;
} => {
    return {
        changeLocale: async (locale: Locale): Promise<void> => {
            store.dispatch(changeLocale(locale));
            await setI18nextMessages(locale);
            await setI18nextLocale(locale);
        },
    };
};

export default useLocale;
