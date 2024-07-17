import { log } from '@commons/core/utils';
import { FC, PropsWithChildren } from 'react';
import { SWRConfig, SWRConfiguration } from 'swr';

export const AppSwrConfig: SWRConfiguration = {
    revalidateOnFocus: false,
};

export type AppSwrConfigProviderProps = PropsWithChildren<{}>;

export const AppSwrConfigProvider: FC<AppSwrConfigProviderProps> = ({ children }: AppSwrConfigProviderProps) => {
    log(`AppSwrConfigProvider initialize.`);
    return <SWRConfig value={AppSwrConfig}>{children}</SWRConfig>;
};
