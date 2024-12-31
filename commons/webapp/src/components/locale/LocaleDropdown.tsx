import { useLocale } from '@commons/core/hooks';
import { getLocale, Locale, locales, LocaleType } from '@commons/core/utils/locale';
import { AppIcon } from '@commons/webapp/components';
import { Button, Dropdown, MenuProps } from 'antd';
import { FC } from 'react';

export interface Props {
    className?: string;
}

const LocaleDropdown: FC<Props> = (props: Props) => {
    const { changeLocale } = useLocale();
    const { className = '' } = props;
    const items: MenuProps['items'] = locales.map((l: LocaleType): { key: Locale; label: string } => {
        return { label: l.title, key: l.locale };
    });
    const onClick: MenuProps['onClick'] = ({ key }): void => {
        changeLocale(getLocale(key)).then();
    };
    return (
        <Dropdown menu={{ items, onClick }} placement="bottomRight" className={className}>
            <Button size={'large'} shape="circle" type="text" icon={<AppIcon icon={'mdi:translate'} />} />
        </Dropdown>
    );
};

export default LocaleDropdown;
