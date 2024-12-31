import { useAppStore } from '@commons/core/store';
import { AppState } from '@commons/core/store/app';
import { Theme } from '@commons/core/utils/theme.ts';

const useTheme = (): { setTheme: (theme: Theme) => Promise<void> } => {
    const changeTheme = useAppStore((state: AppState) => state.changeTheme);
    return {
        setTheme: async (theme: Theme): Promise<void> => {
            changeTheme(theme);
        },
    };
};

export default useTheme;
