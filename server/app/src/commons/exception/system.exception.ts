import { HttpStatus } from '@nestjs/common';
import { HttpException } from '@nestjs/common/exceptions/http.exception';
import { Web } from '../utils/web';

/**
 * 系统异常
 */
export class SystemException extends HttpException {
    constructor(code: number, message: string, data: any = {}) {
        const response = Web.error(code, message, data);
        super(response, HttpStatus.INTERNAL_SERVER_ERROR);
    }
}
