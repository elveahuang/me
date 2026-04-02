import { create } from 'zustand/react';

export interface UserState {
    accessToken: string;
    refreshToken: string;
}

export const useUserStore = create<UserState>()((set, get: () => UserState) => ({
    accessToken: null,
    refreshToken: null,
    login: async (): Promise<void> => {},
    logout: async (): Promise<void> => {},
}));
