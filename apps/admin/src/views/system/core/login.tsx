import { EntryLayout } from '@/layouts';
import { RootDispatch, useRootDispatch } from '@commons/core/store';
import { loginAsync } from '@commons/core/store/actions';
import { Credentials } from '@commons/core/types';
import { credentials, log } from '@commons/core/utils';
import { AppIcon } from '@commons/webapp/components';
import { useMount } from 'ahooks';
import { Button, Card, Form, Input } from 'antd';
import { useTranslation } from 'react-i18next';
import { NavigateFunction, useNavigate } from 'react-router-dom';

const Login = () => {
    const { t } = useTranslation();
    const navigate: NavigateFunction = useNavigate();
    const dispatch: RootDispatch = useRootDispatch();
    const onFinish = async (values: Credentials): Promise<void> => {
        await dispatch(loginAsync(values)).then(async (): Promise<void> => {
            navigate('/', { replace: true });
        });
    };
    const onFinishFailed = (e: any): void => {
        console.log(e);
    };

    useMount(async (): Promise<void> => {
        log('Page <<Login>> mounted.');
    });

    return (
        <EntryLayout>
            <div className="mb-36 content-center sm:w-full md:w-9/12 lg:w-6/12 xl:w-4/12">
                <Card title={t('common:user_pages_login_title')}>
                    <Form<Credentials> className={'login-form'} initialValues={credentials} onFinish={onFinish} onFinishFailed={onFinishFailed}>
                        <Form.Item name="username" rules={[{ required: true, message: t('common:user_field_username_validation') }]}>
                            <Input
                                size="large"
                                prefix={<AppIcon icon="mdi:account-outline" />}
                                placeholder={t('common:user_field_username_placeholder_login')}
                            />
                        </Form.Item>
                        <Form.Item name="password" rules={[{ required: true, message: t('common:user_field_password_validation') }]}>
                            <Input.Password
                                size="large"
                                prefix={<AppIcon icon="mdi:lock-outline" />}
                                placeholder={t('common:user_field_password_placeholder')}
                            />
                        </Form.Item>
                        <Form.Item>
                            <Button size={'large'} block type="primary" htmlType="submit">
                                {t('common:button_login')}
                            </Button>
                        </Form.Item>
                    </Form>
                </Card>
            </div>
        </EntryLayout>
    );
};

export default Login;
