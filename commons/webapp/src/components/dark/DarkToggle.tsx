import { useDark } from '@commons/core/hooks';
import { useAppSelector } from '@commons/core/store';
import { DarkMode } from '@commons/core/utils/dark';
import { AppIcon } from '@commons/webapp/components';
import { Button } from 'antd';

const DarkToggle = () => {
    const { dark } = useAppSelector();
    const { setDarkMode } = useDark();
    return (
        <Button
            size={'large'}
            shape="circle"
            type="text"
            icon={<AppIcon icon={dark ? 'mdi:weather-night' : 'mdi:white-balance-sunny'} />}
            onClick={(): void => {
                setDarkMode(dark ? DarkMode.LIGHT : DarkMode.DARK).then();
            }}
        />
    );
};

export default DarkToggle;
