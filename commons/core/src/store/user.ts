import {
    loginApi,
    LoginApiParams,
    LoginApiResult,
    logoutApi,
    LogoutApiResult,
    refreshApi,
    RefreshApiResult,
    userInfoApi,
    UserInfoApiResult,
} from '@commons/core/api/auth.ts';
import { User } from '@commons/core/types';
import { storage } from '@commons/core/utils/storage';
import { create } from 'zustand/react';

export interface UserState {
    accessToken: string;
    refreshToken: string;
    user: User;
    setAccessToken: (accessToken: string) => Promise<void>;
    setRefreshToken: (refreshToken: string) => Promise<void>;
    setUser: (user: User) => Promise<void>;
    clearUser: () => Promise<void>;
    login: (params: LoginApiParams) => Promise<LoginApiResult>;
    refresh: () => Promise<RefreshApiResult>;
    logout: () => Promise<LogoutApiResult>;
    getUserInfo: () => Promise<UserInfoApiResult>;
    isAuthenticated: () => boolean;
}

export const useUserStore = create<UserState>()((set, get: () => UserState) => ({
    accessToken: storage.getAccessToken() || null,
    refreshToken: storage.getRefreshToken() || null,
    user: null,
    setAccessToken: async (accessToken: string): Promise<void> => {
        set({ accessToken: accessToken });
    },
    setRefreshToken: async (refreshToken: string): Promise<void> => {
        set({ refreshToken: refreshToken });
    },
    setUser: async (user: User): Promise<void> => {
        set((state: UserState) => ({
            user: { ...state.user, user },
        }));
    },
    clearUser: async (): Promise<void> => {},
    login: async (params: LoginApiParams): Promise<LoginApiResult> => {
        return loginApi(params).then((result: LoginApiResult): LoginApiResult => {
            if (result.access_token && result.refresh_token) {
                set((state: UserState) => ({
                    accessToken: result.access_token,
                    refreshToken: result.refresh_token,
                }));
            }
            return result;
        });
    },
    refresh: async (): Promise<LoginApiResult> => {
        return refreshApi().then((result: LoginApiResult): RefreshApiResult => {
            if (result.access_token && result.refresh_token) {
                set((state: UserState) => ({
                    accessToken: result.access_token,
                    refreshToken: result.refresh_token,
                }));
            }
            return result;
        });
    },
    logout: async (): Promise<LogoutApiResult> => {
        return logoutApi().then(async (result: LogoutApiResult): Promise<LogoutApiResult> => {
            return result;
        });
    },
    getUserInfo: async (): Promise<UserInfoApiResult> => {
        return userInfoApi().then((result: UserInfoApiResult): UserInfoApiResult => {
            // if (result.code == '200') {
            //     // this.setUser(result.data);
            // }
            return result;
        });
    },
    isAuthenticated: (): boolean => get().user != null,
}));
