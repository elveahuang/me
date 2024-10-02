import { log } from '@commons/core/utils';
import { useMount } from 'ahooks';
import { TabBar } from 'antd-mobile';
import { AddCircleOutline } from 'antd-mobile-icons';
import { useEffect } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';

const Tabs = () => {
    const location = useLocation();
    const navigate = useNavigate();
    const onChange = (key: string): void => {
        navigate(key);
    };
    const tabs = [
        {
            key: '/home',
            title: '首页',
            icon: <AddCircleOutline />,
        },
        {
            key: '/discover',
            title: 'Discover',
            icon: <AddCircleOutline />,
        },
        {
            key: '/me',
            title: '我的',
            icon: <AddCircleOutline />,
        },
    ];
    useEffect(() => {
        log(location.pathname);
    }, [location]);
    useMount(async () => {
        log(`Component Tabs for mobile mount.`);
    });
    return (
        <div className={'page-layout'}>
            <div className={'page-main'}>
                <Outlet />
            </div>
            <div className={'page-footer'}>
                <TabBar safeArea activeKey={location.pathname} onChange={onChange}>
                    {tabs.map((item) => (
                        <TabBar.Item key={item.key} icon={item.icon} title={item.title} />
                    ))}
                </TabBar>
            </div>
        </div>
    );
};

export default Tabs;
