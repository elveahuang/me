import { ValidationItem } from '@/commons/types/validation';
import { Web } from '@/commons/utils/web';
import { HttpStatus } from '@nestjs/common';
import { HttpException } from '@nestjs/common/exceptions/http.exception';

/**
 * 输入验证异常
 */
export class ValidationException extends HttpException {
    constructor(errors: ValidationItem[]) {
        const response = Web.error(100000, 'Validation failed', {
            errors: errors,
        });
        super(response, HttpStatus.OK);
    }
}
