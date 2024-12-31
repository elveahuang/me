import { settings } from '@/settings';
import { AppDarkToggle, AppLocaleDropdown, AppThemeDropdown } from '@commons/webapp/components';
import { Layout } from 'antd';
import React, { FC } from 'react';
import './EntryLayout.scss';

export type EntryLayoutProps = React.PropsWithChildren<{}>;

const EntryLayout: FC<EntryLayoutProps> = (props: EntryLayoutProps) => {
    const title: string = settings.app.getTitle();
    const copyright: string[] = settings.app.getCopyright();

    return (
        <Layout className="app-layout app-layout-entry">
            <Layout.Header className="app-layout-header">
                <div className="app-layout-header-container">
                    <div className="app-layout-logo">
                        <div className="logo">
                            <span>{title}</span>
                        </div>
                    </div>
                    <div className="app-layout-nav"></div>
                    <div className="app-layout-tools">
                        <AppDarkToggle />
                        <AppThemeDropdown />
                        <AppLocaleDropdown />
                    </div>
                </div>
            </Layout.Header>
            <Layout.Content className="app-layout-content">
                <div className="app-layout-content-container">{props.children}</div>
            </Layout.Content>
            <Layout.Footer className="app-layout-footer">
                <div className="app-layout-footer-container">
                    {copyright.map((text: string, index: number) => {
                        return <div key={index} className="app-text" dangerouslySetInnerHTML={{ __html: text }}></div>;
                    })}
                </div>
            </Layout.Footer>
        </Layout>
    );
};

export default EntryLayout;
