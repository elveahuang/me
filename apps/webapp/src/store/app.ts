import { create } from 'zustand/react';

export interface AppState {
    title: string;
}

export const useAppStore = create<AppState>()((set, get: () => AppState) => ({
    title: '',
    initialize: async (): Promise<void> => {},
}));
