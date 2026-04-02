import winston, { Logger } from 'winston';

const logger: Logger = winston.createLogger({
    level: 'info',
    format: winston.format.json(),
    transports: [
        new winston.transports.File({ dirname: 'logs', filename: 'error.log', level: 'error' }),
        new winston.transports.File({ dirname: 'logs', filename: 'debug.log' }),
    ],
});

if (process.env.NODE_ENV !== 'production') {
    logger.add(
        new winston.transports.Console({
            format: winston.format.simple(),
        }),
    );
}

export default logger;
