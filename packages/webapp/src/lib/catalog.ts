import { defineCatalog } from '@json-render/core';
import { schema } from '@json-render/react/schema';
import { z } from 'zod';

/**
 * json-render 组件目录：
 * - 服务端：用 `catalog.prompt()` 生成系统提示词，教模型输出 ```json-render 代码块
 * - 客户端：用 `defineRegistry(catalog, ...)` 把组件名映射到 React 实现
 * 端共同 import 本文件，保证提示词与渲染器永远一致。
 */
export const catalog = defineCatalog(schema, {
    components: {
        Card: {
            props: z.object({
                title: z.string().describe('卡片标题'),
                description: z.string().nullable().describe('可选的副标题/说明'),
            }),
            description: '卡片容器，用来分组展示内容，可以嵌套其他组件',
        },
        Stat: {
            props: z.object({
                label: z.string().describe('指标名称'),
                value: z.string().describe('指标数值（字符串，可含单位）'),
                hint: z.string().nullable().describe('可选的补充说明'),
            }),
            description: '数据指标卡，展示一个关键数字',
        },
        Badge: {
            props: z.object({
                label: z.string().describe('标签文字'),
                tone: z.enum(['info', 'success', 'warning', 'danger', 'neutral']).nullable().describe('标签色调'),
            }),
            description: '状态/标签徽章',
        },
        Alert: {
            props: z.object({
                message: z.string().describe('提示内容'),
                level: z.enum(['info', 'success', 'warning', 'danger']).nullable().describe('提示级别'),
            }),
            description: '重要提示块',
        },
    },
    actions: {},
});
