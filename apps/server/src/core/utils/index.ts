import { env } from '@/core/env';
import { v4 } from 'uuid';

export const version = '25.3.0';

export function log(log: any): void {
    if (env.debug.enabled) {
        console.log(log);
    }
}

export function uuid(): string {
    return v4();
}

export function getValue<T>(obj: T, key: keyof T): T[keyof T] {
    return obj[key];
}
