import { EntryLayout } from '@/layouts';
import { UserOutlined } from '@ant-design/icons';
import { useRootDispatch } from '@commons/core/store';
import { loginAsync } from '@commons/core/store/actions.ts';
import { Credentials } from '@commons/core/types';
import { Button, Card, Col, Form, Input, Row } from 'antd';
import { FC } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, NavigateFunction, useNavigate } from 'react-router-dom';

const initialFormValues: Credentials = {
    username: 'admin',
    password: 'admin',
};

const Login: FC = () => {
    const { t } = useTranslation();
    const navigate: NavigateFunction = useNavigate();
    const dispatch = useRootDispatch();

    const onFinish = async (values: any): Promise<void> => {
        const params: Credentials = {
            username: values.username,
            password: values.password,
        };
        dispatch(loginAsync(params)).then((): void => {
            navigate('/', { replace: true });
        });
    };

    const onFinishFailed = (e: any): void => {
        console.log(e);
    };

    return (
        <EntryLayout layoutClassName={'entry-layout'}>
            <Row justify={'center'} align={'middle'} style={{ height: '100%' }}>
                <Col xs={{ span: 20 }} sm={{ span: 16 }} md={{ span: 12 }} lg={{ span: 10 }} xl={{ span: 8 }}>
                    <Card className={'login-card'} title={t('common:user_page_login_title')}>
                        <Form<Credentials>
                            className={'login-form'}
                            initialValues={initialFormValues}
                            onFinish={onFinish}
                            onFinishFailed={onFinishFailed}
                        >
                            <Form.Item name="username" rules={[{ required: true, message: 'Please input your Username!' }]}>
                                <Input prefix={<UserOutlined />} type="text" size="large" placeholder={t('common:user_page_login_title')} />
                            </Form.Item>
                            <Form.Item name="password" rules={[{ required: true, message: 'Please input your Password!' }]}>
                                <Input.Password size="large" prefix={<UserOutlined />} placeholder={t('common:user_page_login_title')} />
                            </Form.Item>
                            <Form.Item>
                                <Button block type="primary" htmlType="submit">
                                    Submit
                                </Button>
                            </Form.Item>
                            <Form.Item>
                                <Row justify={'center'} align={'middle'}>
                                    <Col span={12} className={'text-left'}>
                                        <Link to="/register">
                                            <Button type="link" htmlType="button">
                                                Register
                                            </Button>
                                        </Link>
                                    </Col>
                                    <Col span={12} className={'text-right'}>
                                        <Link to="/register">
                                            <Button type="link" className={'right-pull'} htmlType="button">
                                                Forgot Password
                                            </Button>
                                        </Link>
                                    </Col>
                                </Row>
                            </Form.Item>
                        </Form>
                    </Card>
                </Col>
            </Row>
        </EntryLayout>
    );
};

export default Login;
