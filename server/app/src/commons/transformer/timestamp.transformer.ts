import dayjs from 'dayjs';
import { ValueTransformer } from 'typeorm';

export class TimestampTransformer implements ValueTransformer {
    constructor(private readonly format: string = 'YYYY-MM-DD HH:mm:ss') {}

    to(value: any) {
        return value;
    }

    from(value: any): string {
        return dayjs(value).format(this.format);
    }
}
