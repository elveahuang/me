import { useTheme } from '@commons/core/hooks';
import themes, { getTheme, ThemeType } from '@commons/core/utils/theme';
import { AppIcon } from '@commons/mobile/components';
import { Button, Picker } from 'antd-mobile';
import { PickerColumnItem, PickerValue } from 'antd-mobile/es/components/picker-view';
import { FC, useState } from 'react';

export interface Props {
    className?: string;
}

const AppLocalePicker: FC<Props> = (props: Props) => {
    const { setTheme } = useTheme();
    const [visible, setVisible] = useState<boolean>(false);
    const items: PickerColumnItem[] = themes.map((l: ThemeType): PickerColumnItem => {
        return { label: l.title, value: l.theme, key: l.theme };
    });
    return (
        <>
            <Button
                className={props.className}
                onClick={(): void => {
                    setVisible(true);
                }}
            >
                <AppIcon icon="ant-design:skin-outlined" />
            </Button>
            <Picker
                columns={[items]}
                visible={visible}
                onClose={(): void => {
                    setVisible(false);
                }}
                onConfirm={(v: PickerValue[]): void => {
                    setTheme(getTheme(v[0] as string)).then();
                }}
            />
        </>
    );
};

export default AppLocalePicker;
