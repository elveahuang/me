import { log } from '@commons/core/utils/index.ts';
import React, { FC } from 'react';
import { Helmet, HelmetProvider } from 'react-helmet-async';
import { useTranslation } from 'react-i18next';

export type AppHelmetProviderProps = React.PropsWithChildren<{}>;

export const AppHelmetProvider: FC<AppHelmetProviderProps> = (props: AppHelmetProviderProps) => {
    log(`AppHelmetProvider initialize.`);
    const { t } = useTranslation();
    return (
        <HelmetProvider>
            <Helmet title={t('common:title')} />
            {props.children}
        </HelmetProvider>
    );
};
