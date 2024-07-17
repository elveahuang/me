import { UserOutlined } from '@ant-design/icons';
import { AppIcon } from '@commons/webapp/components';
import { Button, Dropdown } from 'antd';
import { NavigateFunction, useNavigate } from 'react-router-dom';

const AvatarDropdown = () => {
    const navigate: NavigateFunction = useNavigate();
    const userMenuProps = {
        items: [
            {
                label: '用户中心',
                key: 'user-center',
                icon: <UserOutlined />,
                onClick: (): void => {
                    navigate('/user-center');
                },
            },
            {
                label: '个人资料',
                key: 'user-center-account',
                icon: <UserOutlined />,
                onClick: (): void => {
                    navigate('/user-center/account');
                },
            },
            {
                label: '修改密码',
                key: 'user-center-password',
                icon: <UserOutlined />,
                onClick: (): void => {
                    navigate('/user-center/password');
                },
            },
            {
                label: '退出',
                key: 'user-center-logout',
                icon: <UserOutlined />,
                onClick: (): void => {
                    navigate('/login');
                },
            },
        ],
    };
    return (
        <Dropdown menu={userMenuProps} placement="bottomRight">
            <Button size={'large'} shape="circle" type="text" icon={<AppIcon icon={'mdi:account'} />} />
        </Dropdown>
    );
};

export default AvatarDropdown;
