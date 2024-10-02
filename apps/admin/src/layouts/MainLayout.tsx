import { AvatarDropdown } from '@/layouts/components';
import { settings } from '@/settings';
import { appSiderMenus } from '@/utils/menus.ts';
import { RootDispatch, useAppSelector, useRootDispatch } from '@commons/core/store';
import { toggleSidebar } from '@commons/core/store/app';
import { Menu as AppMenu, getFirstMenuKey, getMatchMenuKey, getRootMenuKeys } from '@commons/core/utils/menu';
import { getMenuItems } from '@commons/core/utils/menu.ts';
import { AppDarkToggle, AppIcon, AppLocaleDropdown, AppThemeDropdown } from '@commons/webapp/components';
import { useAntdTheme } from '@commons/webapp/hooks';
import { getItem } from '@commons/webapp/utils';
import { Layout, Menu } from 'antd';
import { ItemType } from 'antd/es/menu/interface';
import { useEffect, useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import './MainLayout.scss';

const MainLayout = () => {
    const { pathname } = useLocation();
    const dispatch: RootDispatch = useRootDispatch();
    const { sidebar } = useAppSelector();
    const token = useAntdTheme();
    const items: ItemType[] = getMenuItems(appSiderMenus).map((menu: AppMenu) => {
        if (menu?.items?.length > 0) {
            const children: ItemType[] = menu.items.map((item: AppMenu) => {
                return getItem(item.key, <Link to={item.path}>{item.title}</Link>, <AppIcon size={16} icon={item.icon} />);
            });
            return getItem(menu.key, menu.title, <AppIcon size={16} icon={menu.icon} />, children);
        } else {
            return getItem(menu.key, <Link to={menu.path}>{menu.title}</Link>, <AppIcon size={16} icon={menu.icon} />);
        }
    });
    const [rootKeys] = useState<string[]>(getRootMenuKeys(appSiderMenus));
    const [openKeys, setOpenKeys] = useState<string[]>([]);
    const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
    const onOpenChange = (keys: string[]): void | boolean => {
        if (sidebar.collapsed) {
            return false;
        }
        const latestOpenKey: string = keys.find((key: string): boolean => openKeys.indexOf(key) === -1);
        if (rootKeys.indexOf(latestOpenKey) === -1) {
            setOpenKeys(keys);
        } else {
            setOpenKeys(latestOpenKey ? [latestOpenKey] : []);
        }
    };

    useEffect((): void => {
        setOpenKeys(getFirstMenuKey(appSiderMenus, pathname));
        setSelectedKeys(getMatchMenuKey(appSiderMenus, pathname));
    }, [pathname]);

    return (
        <Layout className="app-layout app-layout-main">
            <Layout.Header
                className="app-layout-header"
                style={{
                    backgroundColor: token.token.colorBgContainer,
                }}
            >
                <div className="app-layout-header-container">
                    <div className="app-layout-trigger">
                        <AppIcon
                            className="trigger"
                            icon={sidebar.collapsed ? 'ant-design:menu-unfold-outlined' : 'ant-design:menu-fold-outlined'}
                            onClick={(): void => {
                                dispatch(toggleSidebar());
                            }}
                        />
                    </div>
                    <div className="app-layout-logo">
                        <div className="logo">
                            <span>{settings.app.getTitle()}</span>
                        </div>
                    </div>
                    <div className="app-layout-nav"></div>
                    <div className="app-layout-tools">
                        <AppDarkToggle />
                        <AppThemeDropdown />
                        <AppLocaleDropdown />
                        <AvatarDropdown />
                    </div>
                </div>
            </Layout.Header>

            <Layout className="app-layout-container">
                <Layout.Sider
                    className={sidebar.collapsed ? 'app-layout-sider collapsed' : 'app-layout-sider'}
                    trigger={null}
                    collapsible
                    collapsed={sidebar.collapsed}
                    collapsedWidth={64}
                    width={200}
                >
                    <Menu
                        className="app-layout-menu"
                        mode="inline"
                        selectedKeys={selectedKeys}
                        openKeys={openKeys}
                        onOpenChange={onOpenChange}
                        items={items}
                    />
                </Layout.Sider>
                <Layout.Content className={sidebar.collapsed ? 'app-layout-content collapsed' : 'app-layout-content'}>
                    <div className="app-layout-content-container">
                        <Outlet />
                    </div>
                </Layout.Content>
            </Layout>
        </Layout>
    );
};

export default MainLayout;
