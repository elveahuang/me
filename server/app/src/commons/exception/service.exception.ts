import { HttpStatus } from '@nestjs/common';
import { HttpException } from '@nestjs/common/exceptions/http.exception';
import { Web } from '../utils/web';

/**
 * 服务异常
 */
export class ServiceException extends HttpException {
    constructor(code: number = 100000, message: string = '', data: any = {}) {
        const response = Web.error(code, message, data);
        super(response, HttpStatus.OK);
    }
}
