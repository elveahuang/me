import { QueryClient } from '@tanstack/react-query';

/** 单例 QueryClient：router context 与根组件 Provider 共用 */
export const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            staleTime: 10_000,
            retry: 1,
            refetchOnWindowFocus: false,
        },
    },
});
