import { RequestContext } from '@/commons/web/request-context';
import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { FastifyRequest } from 'fastify';

/**
 * Context
 */
export const Context = createParamDecorator((data: string = '', ctx: ExecutionContext): RequestContext => {
    console.log('createParamDecorator Context...');
    const request: FastifyRequest = ctx.switchToHttp().getRequest<FastifyRequest>();
    console.log(request.headers['clientId'] as string);
    return {
        ua: request.headers['user-agent'],
        ip: request.ip,
        locale: request.hostname,
        clientId: request.headers['clientId'] as string,
        clientVersion: request.headers['clientVersion'] as string,
    };
});
