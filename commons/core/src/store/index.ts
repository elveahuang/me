import appReducer from '@commons/core/store/app';
import userReducer from '@commons/core/store/user';
import { log } from '@commons/core/utils';
import { combineReducers, configureStore } from '@reduxjs/toolkit';
import { TypedUseSelectorHook, useDispatch, useSelector } from 'react-redux';

export const createStore = () => {
    return configureStore({
        reducer: combineReducers({
            app: appReducer,
            user: userReducer,
        }),
    });
};
export let store: ReturnType<typeof createStore>;
export const setupStore = async (): Promise<void> => {
    log(`Store initialize...`);
    store = createStore();
};
export type RootState = ReturnType<typeof store.getState>;
export type RootDispatch = typeof store.dispatch;
export type RootStore = typeof store;
export { appReducer, userReducer };
export default store;
export const useRootDispatch: () => RootDispatch = useDispatch;
export const useRootSelector: TypedUseSelectorHook<RootState> = useSelector;
export const useAppSelector = () => useRootSelector((state: RootState) => state.app);
export const useUserSelector = () => useRootSelector((state: RootState) => state.user);
export const useStoreExternal = (): RootStore => store;
