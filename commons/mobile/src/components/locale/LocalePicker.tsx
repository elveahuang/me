import { useLocale } from '@commons/core/hooks';
import { getLocale, locales, LocaleType } from '@commons/core/utils/locale';
import { AppIcon } from '@commons/mobile/components';
import { Button, Picker } from 'antd-mobile';
import { PickerColumnItem, PickerValue } from 'antd-mobile/es/components/picker-view';
import { FC, useState } from 'react';

export interface Props {
    className?: string;
}

const AppLocalePicker: FC<Props> = (props: Props) => {
    const { changeLocale } = useLocale();
    const [visible, setVisible] = useState<boolean>(false);
    const items: PickerColumnItem[] = locales.map((l: LocaleType): PickerColumnItem => {
        return { label: l.title, value: l.locale, key: l.locale };
    });
    return (
        <>
            <Button
                className={props.className}
                onClick={(): void => {
                    setVisible(true);
                }}
            >
                <AppIcon icon="mdi:translate" />
            </Button>
            <Picker
                columns={[items]}
                visible={visible}
                onClose={(): void => {
                    setVisible(false);
                }}
                onConfirm={(v: PickerValue[]): void => {
                    changeLocale(getLocale(v[0] as string)).then();
                }}
            />
        </>
    );
};

export default AppLocalePicker;
