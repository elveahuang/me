import { useDark } from '@commons/core/hooks';
import { darkModes, DarkModeType, getDarkMode } from '@commons/core/utils/dark';
import { AppIcon } from '@commons/mobile/components';
import { Button, Picker } from 'antd-mobile';
import { PickerColumnItem, PickerValue } from 'antd-mobile/es/components/picker-view';
import { FC, useState } from 'react';

export interface Props {
    className?: string;
}

const AppLocalePicker: FC<Props> = (props: Props) => {
    const { setDarkMode } = useDark();
    const [visible, setVisible] = useState<boolean>(false);
    const items: PickerColumnItem[] = darkModes.map((l: DarkModeType): PickerColumnItem => {
        return { label: l.title, value: l.mode, key: l.mode };
    });
    return (
        <>
            <Button
                className={props.className}
                onClick={(): void => {
                    setVisible(true);
                }}
            >
                <AppIcon icon="line-md:light-dark-loop" />
            </Button>
            <Picker
                columns={[items]}
                visible={visible}
                onClose={(): void => {
                    setVisible(false);
                }}
                onConfirm={(v: PickerValue[]): void => {
                    setDarkMode(getDarkMode(v[0] as string)).then();
                }}
            />
        </>
    );
};

export default AppLocalePicker;
