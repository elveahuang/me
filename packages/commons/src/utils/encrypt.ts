import { cbc } from '@noble/ciphers/aes.js';
import { trim } from 'es-toolkit/compat';

const KEY = '1234567812345678';
const IV = '1234567812345678';
const AES_KEY = new TextEncoder().encode(KEY);
const AES_IV = new TextEncoder().encode(IV);

const textEncoder = new TextEncoder();

function toBase64(bytes: Uint8Array): string {
    let binary: string = '';
    // 分块拼接，避免 String.fromCharCode 入参过多导致栈溢出
    for (let index: number = 0; index < bytes.length; index += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
    }
    return btoa(binary);
}

function toHex(bytes: Uint8Array): string {
    return Array.from(bytes, (byte: number): string => byte.toString(16).padStart(2, '0')).join('');
}

function aesEncrypt(text: string): string {
    const encrypted = cbc(AES_KEY, AES_IV).encrypt(textEncoder.encode(trim(text)));
    return toBase64(encrypted);
}

export function encrypt(text: string): string {
    const encrypted = aesEncrypt(text);
    return toHex(textEncoder.encode(encrypted));
}
