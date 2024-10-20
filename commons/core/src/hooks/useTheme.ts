import { store } from '@commons/core/store';
import { changeTheme } from '@commons/core/store/app';
import { Theme } from '@commons/core/utils/theme.ts';

const useTheme = (): { setTheme: (theme: Theme) => Promise<void> } => {
    return {
        setTheme: async (theme: Theme): Promise<void> => {
            store.dispatch(changeTheme(theme));
        },
    };
};

export default useTheme;
