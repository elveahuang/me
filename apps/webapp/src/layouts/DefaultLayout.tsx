import { Layout } from 'antd';
import classNames from 'classnames';
import React, { FC, PropsWithChildren } from 'react';
import { useTranslation } from 'react-i18next';
import './DefaultLayout.scss';

export type DefaultLayoutProps = React.PropsWithChildren<{ layoutClassName?: string }>;

const DefaultLayout: FC<DefaultLayoutProps> = (props: PropsWithChildren<DefaultLayoutProps>) => {
    const { t } = useTranslation();

    return (
        <Layout className={classNames('default-layout', props.layoutClassName || '')}>
            <Layout.Content>{props.children}</Layout.Content>
            <Layout.Footer id="footer">{t('common:copyright')}</Layout.Footer>
        </Layout>
    );
};

export default DefaultLayout;
