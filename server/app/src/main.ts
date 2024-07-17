import { HttpExceptionFilter } from '@/commons/filter/http-exception.filter';
import { TimeoutInterceptor } from '@/commons/interceptor/timeout.interceptor';
import { AppModule } from '@/modules/main/app.module';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { join } from 'path';

async function bootstrap(): Promise<void> {
    console.log(`App bootstrap...`);
    const app: NestFastifyApplication = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter());

    // Cors
    app.enableCors({
        origin: true,
        credentials: true,
        maxAge: 1728000,
    });

    // Pipe
    app.useGlobalPipes(new ValidationPipe());
    // Interceptor
    app.useGlobalInterceptors(new TimeoutInterceptor());
    // Filter
    app.useGlobalFilters(new HttpExceptionFilter());
    // View
    app.useStaticAssets({
        root: join(__dirname, '..', 'public'),
        prefix: '/',
    });
    app.setViewEngine({
        engine: { handlebars: require('handlebars') },
        templates: join(__dirname, '..', 'views'),
    });

    const config: ConfigService = app.get(ConfigService);
    const host: string = config.get<string>('HOST') || '0.0.0.0';
    const port: number = config.get<number>('PORT') || 8080;
    console.log(`App bootstrap ${__dirname}.`);
    await app.listen(port, host);
    console.log(`App has been started. [host - ${host}] [port - ${port}].`);
}

bootstrap().then((): void => {
    console.log(`App has been started.`);
});
