/**
 * 验证错误信息
 */
export interface ValidationItem {
    /**
     * 属性名
     */
    key?: string | any;
    /**
     * 属性显示文本
     */
    label: string;
    /**
     * 属性值
     */
    value: any;
    /**
     * 错误信息
     */
    message: string | Array<string>;
}
