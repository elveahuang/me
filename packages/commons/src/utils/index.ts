import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export { Icon as VIcon } from '@iconify/react';

export function test(): void {
    console.log('Hello World!');
}

export function log(log: any): void {
    console.log(log);
}

export function cn(...inputs: ClassValue[]): string {
    return twMerge(clsx(inputs));
}
