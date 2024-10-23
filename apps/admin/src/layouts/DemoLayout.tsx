import { Layout } from 'antd';
import { Outlet } from 'react-router-dom';
import './DemoLayout.scss';

const DemoLayout = () => {
    return (
        <Layout className="app-layout app-layout-demo">
            <Layout.Content className="app-layout-content">
                <Outlet />
            </Layout.Content>
        </Layout>
    );
};

export default DemoLayout;
