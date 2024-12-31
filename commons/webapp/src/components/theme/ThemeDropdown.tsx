import { useTheme } from '@commons/core/hooks';
import { getTheme, Theme, themes, ThemeType } from '@commons/core/utils/theme';
import { AppIcon } from '@commons/webapp/components';
import { Button, Dropdown, MenuProps } from 'antd';

const ThemeDropdown = () => {
    const { setTheme } = useTheme();
    const items: MenuProps['items'] = themes.map((l: ThemeType): { label: string; key: Theme } => {
        return { label: l.title, key: l.theme };
    });
    const onClick: MenuProps['onClick'] = ({ key }): void => {
        setTheme(getTheme(key)).then();
    };
    return (
        <Dropdown menu={{ items, onClick }} placement="bottomRight">
            <Button size={'large'} shape="circle" type="text" icon={<AppIcon icon={'mdi:theme'} />} />
        </Dropdown>
    );
};

export default ThemeDropdown;
