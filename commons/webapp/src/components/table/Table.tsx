import { Key } from '@commons/core/types';
import { DataTable } from '@commons/core/utils/data-table.ts';
import { useMount } from 'ahooks';
import { Table as AntdTable, TablePaginationConfig } from 'antd';
import { TableRowSelection } from 'antd/es/table/interface';
import { isFunction } from 'lodash-es';
import type * as React from 'react';
import { Ref, forwardRef, useImperativeHandle, useState } from 'react';

export interface TableProps {
    model: DataTable;
    rowKey?: string;
    rowSelectionEnabled?: boolean;
    rowSelectionMultipleEnabled?: boolean;
    rowSelection?: TableRowSelection<any>;
    paginationEnabled?: boolean;
    pagination?: TablePaginationConfig;
    getDataList?: () => Promise<void>;
}

export interface TableRef {
    hello: () => void;
    refresh: () => void;
    getSelectedRowKeys: () => any[];
    getSelectedRows: () => any[];
}

const Table = forwardRef((props: TableProps, ref: Ref<TableRef>) => {
    const { model, getDataList, rowKey = 'id' } = props;
    const { rowSelectionEnabled = false, rowSelectionMultipleEnabled = false, rowSelection } = props;
    const { paginationEnabled = true, pagination } = props;
    const [tableSelectedRowKeys, setTableSelectedRowKeys] = useState<Key[]>([]);
    const [tableSelectedRows, setTableSelectedRows] = useState<any[]>([]);
    const tableRowSelection: TableRowSelection<any> = rowSelectionEnabled
        ? rowSelection || {
              type: rowSelectionMultipleEnabled ? 'checkbox' : 'radio',
              onChange: (selectedRowKeys: React.Key[], selectedRows: any[]): void => {
                  setTableSelectedRowKeys(selectedRowKeys as Key[]);
                  setTableSelectedRows(selectedRows);
              },
              columnWidth: '50px',
          }
        : null;
    const tablePagination: TablePaginationConfig = paginationEnabled
        ? pagination || {
              pageSize: model.pagination.size,
              total: model.pagination.total as number,
          }
        : null;
    const onTableChange = async (pagination: TablePaginationConfig): Promise<void> => {
        model.pagination.size = pagination.pageSize;
        model.pagination.page = pagination.current;
        await getDataList().then();
    };

    useMount(async (): Promise<void> => {
        if (isFunction(getDataList)) {
            await getDataList().then();
        }
    });

    useImperativeHandle(ref, (): TableRef => {
        return {
            hello: (): void => {
                console.log('useImperativeHandle.hello');
            },
            refresh: async (): Promise<void> => {
                model.pagination.page = 2;
                if (isFunction(getDataList)) {
                    await getDataList().then();
                }
            },
            getSelectedRowKeys: (): Key[] => {
                return Array.from(tableSelectedRowKeys);
            },
            getSelectedRows: (): any[] => {
                return Array.from(tableSelectedRows);
            },
        };
    });

    return (
        <>
            <AntdTable
                bordered
                size={'small'}
                rowKey={rowKey}
                loading={model.loading}
                columns={model.columns}
                dataSource={model.items}
                rowSelection={tableRowSelection}
                pagination={tablePagination}
                onChange={onTableChange}
            />
        </>
    );
});
Table.displayName = 'Table';
export default Table;
