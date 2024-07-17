import { Page, R } from '@/commons/types';
import { isEmpty } from 'radash';

/**
 * WebUtils
 */
export class Web {
    public static STATUS_SUCCESS: number = 200;
    public static STATUS_ERROR: number = 10000;

    /**
     * 返回统一格式的成功响应信息
     *
     * @param data 数据
     */
    public static success(data: any = {}): R {
        console.log(data);
        return {
            code: Web.STATUS_SUCCESS,
            data: data,
            message: 'success',
        };
    }

    /**
     * 返回统一格式的响应失败信息
     *
     * @param code      错误编号
     * @param message   错误信息
     * @param data      错误数据
     */
    public static error(code: number = 100000, message: string = '', data: any = {}) {
        if (isEmpty(data)) {
            return {
                status: Web.STATUS_ERROR,
                code: code,
                message: message,
            };
        } else {
            return {
                status: Web.STATUS_ERROR,
                code: code,
                data: data,
                message: message,
            };
        }
    }

    public static page<T>(data: Page<T>): R<Page<T>> {
        return {
            code: 200,
            data: data,
            message: 'success',
        };
    }
}
