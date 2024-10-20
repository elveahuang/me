import { logo } from '@commons/core/constants/images';
import { AppLoading } from '@commons/webapp/components';
import { Col, Layout, Menu, Row } from 'antd';
import classNames from 'classnames';
import React, { FC, PropsWithChildren, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { Outlet, useLocation } from 'react-router-dom';
import './MainLayout.scss';

export type MainLayoutProps = React.PropsWithChildren<{ layoutClassName?: string }>;

const MainLayout: FC<MainLayoutProps> = (props: PropsWithChildren<MainLayoutProps>) => {
    const { t } = useTranslation();
    const location = useLocation();
    const layoutClassName = classNames('main-layout', location.pathname === '/home' ? 'home-layout' : props.layoutClassName || '');
    const items = [
        { label: 'Home', key: 'home' },
        { label: 'About', key: 'about' },
    ];
    return (
        <Layout className={layoutClassName}>
            <Layout.Header id="header" className="header">
                <Row className="header-row">
                    <Col md={6} sm={24}>
                        <span className="header-logo">
                            <img alt="logo" src={logo} />
                            <span>Application</span>
                        </span>
                    </Col>
                    <Col md={18} sm={0}>
                        <div className="header-menu">
                            <Menu mode="horizontal" items={items} />
                        </div>
                    </Col>
                </Row>
            </Layout.Header>
            <Layout.Content>
                <Suspense fallback={<AppLoading />}>
                    <Outlet />
                </Suspense>
            </Layout.Content>
            <Layout.Footer id="footer">{t('common:copyright')}</Layout.Footer>
        </Layout>
    );
};

export default MainLayout;
