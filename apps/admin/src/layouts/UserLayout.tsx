import { AvatarDropdown } from '@/layouts/components';
import { settings } from '@/settings';
import { userCenterMenus } from '@/utils/menus.ts';
import { Menu as AppMenu, getMatchMenuKey } from '@commons/core/utils/menu';
import { getMenuItems } from '@commons/core/utils/menu.ts';
import { AppDarkToggle, AppIcon, AppLocaleDropdown, AppThemeDropdown } from '@commons/webapp/components';
import { useAntdTheme } from '@commons/webapp/hooks';
import { getItem } from '@commons/webapp/utils';
import { Button, Layout, Menu } from 'antd';
import { ItemType } from 'antd/es/menu/interface';
import { FC, useEffect, useState } from 'react';
import { Link, NavigateFunction, Outlet, useLocation, useNavigate } from 'react-router-dom';
import './UserLayout.scss';

const UserLayout: FC = () => {
    const navigate: NavigateFunction = useNavigate();
    const { pathname } = useLocation();
    const token = useAntdTheme();
    const items: ItemType[] = getMenuItems(userCenterMenus).map((menu: AppMenu) => {
        return getItem(menu.key, <Link to={menu.path}>{menu.title}</Link>, <AppIcon size={16} icon={menu.icon} />);
    });
    const [selectedKeys, setSelectedKeys] = useState<string[]>([]);

    useEffect((): void => {
        setSelectedKeys(getMatchMenuKey(userCenterMenus, pathname));
    }, [pathname]);

    return (
        <Layout className="app-layout app-layout-user">
            <Layout.Header
                className="app-layout-header"
                style={{
                    backgroundColor: token.token.colorBgContainer,
                }}
            >
                <div className="app-layout-header-container">
                    <div className="app-layout-logo">
                        <div className="logo">
                            <span>{settings.app.getTitle()}</span>
                        </div>
                    </div>
                    <div className="app-layout-nav"></div>
                    <div className="app-layout-tools">
                        <Button
                            size={'large'}
                            shape="circle"
                            type="text"
                            icon={<AppIcon icon="mdi:home" />}
                            onClick={(): void => {
                                navigate('/');
                            }}
                        />
                        <AppDarkToggle />
                        <AppThemeDropdown />
                        <AppLocaleDropdown />
                        <AvatarDropdown />
                    </div>
                </div>
            </Layout.Header>

            <Layout className="app-layout-container">
                <Layout.Sider className="app-layout-sider">
                    <Menu className="app-layout-menu" mode="inline" selectedKeys={selectedKeys} items={items} />
                </Layout.Sider>
                <Layout.Content className="app-layout-content">
                    <div className="app-layout-content-container">
                        <Outlet />
                    </div>
                </Layout.Content>
            </Layout>
        </Layout>
    );
};

export default UserLayout;
