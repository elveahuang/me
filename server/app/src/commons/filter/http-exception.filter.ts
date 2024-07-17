import { ServiceException } from '@/commons/exception/service.exception';
import { SystemException } from '@/commons/exception/system.exception';
import { ValidationException } from '@/commons/exception/validation-exception';
import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import { HttpArgumentsHost } from '@nestjs/common/interfaces';

@Catch(HttpException)
export class HttpExceptionFilter implements ExceptionFilter {
    catch(exception: HttpException, host: ArgumentsHost): void {
        console.log(`HttpExceptionFilter.catch()...`);
        console.log(exception);
        const ctx: HttpArgumentsHost = host.switchToHttp();
        const response = ctx.getResponse();
        const request = ctx.getRequest();
        const statusCode: number = exception.getStatus();

        if (exception instanceof ServiceException) {
            response.status(statusCode).send(exception.getResponse());
        } else if (exception instanceof SystemException) {
            response.status(statusCode).send(exception.getResponse());
        } else if (exception instanceof ValidationException) {
            response.status(statusCode).send(exception.getResponse());
        } else {
            response.status(statusCode).send({
                statusCode,
                timestamp: new Date().toISOString(),
                path: request.url,
            });
        }
        console.log(`HttpExceptionFilter.catch() finish.`);
    }
}
