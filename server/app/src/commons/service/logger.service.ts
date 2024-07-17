import { ConsoleLogger, Injectable } from '@nestjs/common';

@Injectable()
export class Logger extends ConsoleLogger {
    error(message: any, trace?: string, context?: string) {
        super.error(message, trace, context);
    }

    warn(message: any, context?: string) {
        super.warn(message, context);
    }

    log(message: any, context?: string) {
        super.log(message, context);
    }

    debug(message: any, context?: string) {
        super.debug(message, context);
    }

    verbose(message: any, context?: string) {
        super.verbose(message, context);
    }
}
