import {
    announcementDeleteApi,
    announcementDetailsApi,
    announcementListApi,
    AnnouncementListApiResult,
    announcementSaveApi,
} from '@commons/core/api/admin/announcement.ts';
import { AppEditor } from '@commons/core/components';
import { Key, R } from '@commons/core/types';
import { Announcement, defaultAnnouncement } from '@commons/core/types/announcement.ts';
import { DataTable, DataTableOptions, setLoadingStatus, useDataTable } from '@commons/core/utils/data-table.ts';
import { AppIcon, AppPageHeader, AppTable } from '@commons/webapp/components';
import { TableRef } from '@commons/webapp/components/table/Table.tsx';
import { defaultFormLayout, toast } from '@commons/webapp/utils';
import { useBoolean } from 'ahooks';
import { Button, Form, Input, Modal, Popconfirm, Space, TableColumnsType } from 'antd';
import { isEmpty } from 'radash';
import { MutableRefObject, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

const AnnouncementIndexPage = () => {
    const { t } = useTranslation();
    const { initialize, handleResult, handleParams } = useDataTable();
    // 数据列表
    const dataTableColumns: TableColumnsType<Announcement> = [
        {
            key: 'title',
            dataIndex: 'title',
            title: t('common:field_title'),
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
                                showEntityFormModal(record.id as number).then();
                            }}
                        />
                        <Button
                            size="small"
                            icon={<AppIcon icon={'ant-design:edit-outlined'} />}
                            onClick={(): void => {
                                showEntityFormModal(record.id as number).then();
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
    const dataTableOptions: DataTableOptions = {
        columns: dataTableColumns,
    };
    const [dataTable, setDataTable] = useState<DataTable>(initialize(dataTableOptions));
    const [dataTableRowSelectionEnabled, { toggle }] = useBoolean(false);
    const dataTableRef: MutableRefObject<TableRef> = useRef();
    const getDataList = async (): Promise<void> => {
        setLoadingStatus(dataTable, true);
        await announcementListApi(handleParams(dataTable)).then((result: R<AnnouncementListApiResult>): void => {
            setDataTable(handleResult(dataTable, result));
        });
    };
    const handleDelete = async (id: Key = 0): Promise<void> => {
        console.log(id);
        const ids: Key[] = id ? [id] : dataTableRef.current.getSelectedRowKeys();
        console.log(ids);
        if (isEmpty(ids)) {
            toast(t('common:label_please_select_one_record')).then();
            return;
        }
        announcementDeleteApi({ ids: ids }).then((result: R<string>): void => {
            if (result.code == '200') {
                dataTableRef.current.refresh();
            }
        });
    };
    // 数据表单
    const [entityFormModalOpen, setEntityFormModalOpen] = useState<boolean>(false);
    const [entityFormModalTitle, setEntityFormModalTitle] = useState<string>();
    const [entityFormModel, setEntityFormModel] = useState<Announcement>({ ...defaultAnnouncement });
    const [entityForm] = Form.useForm<Announcement>();
    const showEntityFormModal = async (id: number = 0): Promise<void> => {
        if (id && id > 0) {
            await announcementDetailsApi({ id: id }).then((result: R<Announcement>): void => {
                const model: Announcement = Object.assign(entityFormModel, result.data);
                setEntityFormModalTitle(t('common:announcement_pages_edit_title'));
                setEntityFormModel(model);
                entityForm.setFieldsValue(model);
                setEntityFormModalOpen(true);
            });
        } else {
            const model: Announcement = Object.assign(entityFormModel, defaultAnnouncement);
            setEntityFormModalTitle(t('common:announcement_pages_add_title'));
            setEntityFormModel(model);
            entityForm.setFieldsValue(model);
            setEntityFormModalOpen(true);
        }
    };
    const handleFormCancel = (): void => {
        console.log(`handleFormCancel...`);
        setEntityFormModalOpen(false);
    };
    const handleFormSubmit = async (values: Announcement): Promise<void> => {
        console.log(`handleFormSubmit...`);
        announcementSaveApi(values).then((result: R<string>): void => {
            if (result.code == '200') {
                setEntityFormModalOpen(false);
                dataTableRef.current.refresh();
            }
        });
    };

    return (
        <>
            <AppPageHeader />
            <div className={'py-4'}>
                <Space>
                    <Button
                        onClick={(): void => {
                            showEntityFormModal(0).then();
                        }}
                    >
                        {t('common:button_add')}
                    </Button>
                    <Button onClick={toggle}>
                        {dataTableRowSelectionEnabled ? t('common:label_batch_operation_cancel') : t('common:label_batch_operation')}
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
                ref={dataTableRef}
                model={dataTable}
                getDataList={getDataList}
                rowSelectionEnabled={dataTableRowSelectionEnabled}
                rowSelectionMultipleEnabled={dataTableRowSelectionEnabled}
            />

            <Modal
                open={entityFormModalOpen}
                title={entityFormModalTitle}
                width={980}
                forceRender
                destroyOnClose={true}
                onOk={(): void => {
                    entityForm.submit();
                }}
                onCancel={(): void => {
                    handleFormCancel();
                }}
            >
                <Form<Announcement>
                    {...defaultFormLayout}
                    form={entityForm}
                    className={'entity-form'}
                    initialValues={defaultAnnouncement}
                    onFinish={handleFormSubmit}
                >
                    <Form.Item name="title" label={t('common:field_title')} rules={[{ required: true, message: t('common:field_title_validation') }]}>
                        <Input placeholder={t('common:field_title_placeholder')} />
                    </Form.Item>
                    <Form.Item
                        name="content"
                        label={t('common:field_content')}
                        rules={[{ required: true, message: t('common:field_content_validation') }]}
                    >
                        <AppEditor
                            content={entityFormModel.content}
                            onChange={(content: string): void => {
                                setEntityFormModel({ ...entityFormModel, ...{ content: content } });
                                entityForm.setFieldValue('content', content);
                            }}
                        />
                    </Form.Item>
                </Form>
                {entityFormModel.content}
            </Modal>
        </>
    );
};

export default AnnouncementIndexPage;
