import { default as config } from '@payload-config';
import { BasePayload, getPayload as getPayloadInstance } from 'payload';

export type PayloadType = BasePayload;

export async function getPayload(): Promise<PayloadType> {
    return getPayloadInstance({ config });
}
