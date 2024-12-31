import { IconProps, Icon as IconifyIcon } from '@iconify/react';
import { FC } from 'react';

export const AppIcon: FC<IconProps> = (props: IconProps) => {
    return (
        <span className={'anticon'}>
            <IconifyIcon {...props} />
        </span>
    );
};

export default AppIcon;
