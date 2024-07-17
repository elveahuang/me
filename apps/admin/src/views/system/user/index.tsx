import { AnnouncementListApiResult } from '@commons/core/api/admin/announcement.ts';
import { userDeleteApi, userDetailsApi, userListApi, userSaveApi } from '@commons/core/api/admin/user.ts';
import { Key, R, User } from '@commons/core/types';
import { DataTable, DataTableOptions, setLoadingStatus, useDataTable } from '@commons/core/utils/data-table.ts';
import { AppIcon, AppPageHeader, AppTable } from '@commons/webapp/components';
import { TableRef } from '@commons/webapp/components/table/Table.tsx';
import { defaultFormItemLayout, defaultFormLayout, toast } from '@commons/webapp/utils';
import { checkUsername } from '@commons/webapp/utils/validation.tsx';
import { useBoolean } from 'ahooks';
import { Button, Form, Input, Modal, Popconfirm, Radio, Space, TableColumnsType } from 'antd';
import { RuleObject } from 'antd/es/form';
import { isEmpty } from 'lodash-es';
import { isInt } from 'radash';
import { MutableRefObject, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

const UserIndexPage = () => {
    const { t } = useTranslation();
    const { initialize, handleResult, handleParams } = useDataTable();
    // 列表
    const tableColumns: TableColumnsType<User> = [
        {
            key: 'username',
            dataIndex: 'username',
            title: t('common:user_field_username'),
        },
        {
            key: 'operations',
            dataIndex: 'id',
            title: t('common:label_action'),
            width: '200px',
            render: (text, record, index) => {
                return (
                    <Space>
                        <Button
                            size="small"
                            icon={<AppIcon icon={'mdi:eye-outline'} />}
                            onClick={(): void => {
                                alert(record.id);
                                handleViewShow(record.id).then();
                            }}
                        ></Button>
                        <Button
                            size="small"
                            icon={<AppIcon icon={'ant-design:edit-outlined'} />}
                            onClick={(): void => {
                                handleFormShow(record.id).then();
                            }}
                        ></Button>
                        <Popconfirm
                            title={t('common:label_confirm_delete_record')}
                            description={t('common:label_confirm_delete_record')}
                            onConfirm={(): void => {
                                handleDelete(record.id).then();
                            }}
                            onCancel={(): void => {}}
                        >
                            <Button size="small" danger icon={<AppIcon icon={'ant-design:close-outlined'} />}></Button>
                        </Popconfirm>
                    </Space>
                );
            },
        },
    ];
    const tableOptions: DataTableOptions = {
        columns: tableColumns,
    };
    const [table, setTable] = useState<DataTable>(initialize(tableOptions));
    const [tableSelectionEnabled, { toggle }] = useBoolean(false);
    const tableRef: MutableRefObject<TableRef> = useRef();
    const getDataList = async (): Promise<void> => {
        setLoadingStatus(table, true);
        await userListApi(handleParams(table)).then((result: R<AnnouncementListApiResult>): void => {
            setTable(handleResult(table, result));
        });
    };
    const handleDelete = async (id: Key = 0): Promise<void> => {
        console.log(id);
        console.log(isInt(id));
        const ids: Key[] = id ? [id] : tableRef.current.getSelectedRowKeys();
        console.log(ids);
        if (isEmpty(ids)) {
            toast(t('common:label_please_select_one_record')).then();
            return;
        }
        userDeleteApi({ ids: ids }).then((result: R<string>): void => {
            if (result.code == '200') {
                tableRef.current.refresh();
            }
        });
    };
    // 表单
    const [formModalOpen, setFormModalOpen] = useState<boolean>(false);
    const [formModalTitle, setFormModalTitle] = useState<string>('');
    const [formModel, setFormModel] = useState<User>({});
    const [form] = Form.useForm();
    const handleFormShow = async (id: number = 0): Promise<void> => {
        if (id && id > 0) {
            setFormModalTitle(t('common:user_pages_edit_title'));
            await userDetailsApi({ id: id }).then((result: R<User>): void => {
                setFormModel(Object.assign(formModel, { ...result.data }));
            });
            setFormModalOpen(true);
        } else {
            setFormModalTitle(t('common:user_pages_add_title'));
            setFormModel(Object.assign(formModel, { status: 0 }));
            setFormModalOpen(true);
        }
    };
    const handleFormSubmit = async (): Promise<void> => {
        form.validateFields().then(async (values: User): Promise<void> => {
            await userSaveApi(values).then((result: R<string>): void => {
                if (result.code == '200') {
                    setFormModalOpen(false);
                    tableRef.current.refresh();
                }
            });
        });
    };
    const handleFormCancel = async (): Promise<void> => {
        setFormModalOpen(false);
    };
    // 详情
    const [viewModalOpen, setViewModalOpen] = useState<boolean>(false);
    const [viewModel, setViewModel] = useState<User>({});
    const handleViewShow = async (id: number = 0): Promise<void> => {
        if (id && id > 0) {
            await userDetailsApi({ id: id }).then((result: R<User>): void => {
                setViewModel(Object.assign(viewModel, { ...result.data }));
            });
            setViewModalOpen(true);
        }
    };
    const handleViewCancel = (): void => {
        setViewModalOpen(false);
    };

    return (
        <>
            <AppPageHeader />
            <div className={'py-4'}>
                <Space>
                    <Button
                        onClick={(): void => {
                            handleFormShow(0).then();
                        }}
                    >
                        {t('common:button_add')}
                    </Button>
                    <Button onClick={toggle}>
                        {tableSelectionEnabled ? t('common:label_batch_operation_cancel') : t('common:label_batch_operation')}
                    </Button>
                    <Button
                        onClick={(): void => {
                            handleDelete().then();
                        }}
                    >
                        {t('common:button_delete')}
                    </Button>
                </Space>
            </div>
            <AppTable
                ref={tableRef}
                model={table}
                getDataList={getDataList}
                rowSelectionEnabled={tableSelectionEnabled}
                rowSelectionMultipleEnabled={tableSelectionEnabled}
            />

            <Modal
                open={viewModalOpen}
                title={t('common:user_field_username')}
                width={980}
                onOk={(): void => {
                    handleViewCancel();
                }}
                onCancel={(): void => {
                    handleViewCancel();
                }}
            >
                {viewModel.username}
            </Modal>

            <Modal
                open={formModalOpen}
                title={formModalTitle}
                width={980}
                onOk={(): void => {
                    handleFormSubmit().then();
                }}
                onCancel={(): void => {
                    handleFormCancel().then();
                }}
            >
                <Form<User> {...defaultFormLayout} form={form} className={'entity-form'} initialValues={formModel}>
                    <Form.Item
                        {...defaultFormItemLayout}
                        name="username"
                        label={t('common:user_field_username')}
                        rules={[
                            { required: true, message: t('common:user_field_username_validation') },
                            ({ getFieldValue }) => ({
                                message: t('common:user_field_username_validation_check'),
                                validator: async (_: RuleObject, value: string): Promise<void> => checkUsername(_, value, getFieldValue('id')),
                            }),
                        ]}
                    >
                        <Input placeholder={t('common:user_field_username_placeholder')} />
                    </Form.Item>
                    <Form.Item
                        {...defaultFormItemLayout}
                        name="displayName"
                        label={t('common:user_field_display_name')}
                        rules={[{ required: true, message: t('common:user_field_display_name_validation') }]}
                    >
                        <Input placeholder={t('common:user_field_display_name_placeholder')} />
                    </Form.Item>
                    <Form.Item
                        {...defaultFormItemLayout}
                        name="password"
                        label={t('common:user_field_password')}
                        rules={[{ required: true, message: t('common:user_field_password_validation') }]}
                    >
                        <Input.Password placeholder={t('common:user_field_password_placeholder')} />
                    </Form.Item>
                    <Form.Item
                        {...defaultFormItemLayout}
                        name="status"
                        label={t('common:field_status')}
                        rules={[{ required: true, message: t('common:user_field_password_validation') }]}
                    >
                        <Radio.Group value={formModel.status}>
                            <Radio value={1}>{t('common:label_status_on')}</Radio>
                            <Radio value={0}>{t('common:label_status_off')}</Radio>
                        </Radio.Group>
                    </Form.Item>
                </Form>
            </Modal>
        </>
    );
};

export default UserIndexPage;
