import { Icon as IconifyIcon } from '@iconify/react';
import { FC } from 'react';

export interface IconProps {
    size?: number;
    icon?: string;
    className?: string;
    onClick?: () => void;
}

const Icon: FC<IconProps> = (props: IconProps) => {
    const { size = 18, icon, className = 'anticon', onClick } = props;
    return (
        <span className={className} onClick={() => onClick}>
            <IconifyIcon icon={icon} width={size} height={size} />
        </span>
    );
};

export default Icon;
