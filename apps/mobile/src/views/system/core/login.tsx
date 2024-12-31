import { AppDarkPicker, AppLocalePicker, AppThemePicker } from '@commons/mobile/components';
import { Button, NavBar } from 'antd-mobile';
import { useTranslation } from 'react-i18next';

const Login = () => {
    const { t } = useTranslation();
    return (
        <div>
            <NavBar back={null}>{t('common:title')}</NavBar>
            <Button color="primary">{t('common:title')}</Button>
            <br />
            <AppDarkPicker />
            <AppLocalePicker />
            <AppThemePicker />
        </div>
    );
};

export default Login;
