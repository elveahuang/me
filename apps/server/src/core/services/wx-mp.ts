import env from '@/core/env';
import { getCacheService, RedisClient } from '@/core/services/cache';
import logger from '@/core/utils/logger';
import axios, { AxiosResponse } from 'axios';
import crypto from 'crypto';
import { isEmpty } from 'es-toolkit/compat';

export const HOST: string = 'https://api.weixin.qq.com';

export interface WxMpAccessTokenResponse {
    access_token: string;
    expires_in: number;
    errcode: number;
    errmsg: string;
}

export interface WxMpJsapiTicketResponse {
    ticket: string;
    expires_in: number;
    errcode: number;
    errmsg: string;
}

export interface WxMpJsapiSignature {
    appId: string;
    nonceStr: string;
    timestamp: string;
    url: string;
    signature: string;
}

export class WxMpService {
    public async getAccessToken(): Promise<string> {
        const redis: RedisClient = await getCacheService().getClient();
        const appId: string = env.wechat.mp.appId;
        const appSecret: string = env.wechat.mp.appSecret;
        const accessTokenKey: string = `wx_mp_${appId}_access_token`;
        const accessTokenValue: string = (await redis.get(accessTokenKey)) as string;

        logger.info(`WxMpService getAccessToken for : ${appId}`);

        if (isEmpty(accessTokenValue)) {
            const endpoint: string = `${HOST}/cgi-bin/token?grant_type=client_credential&appid=${appId}&secret=${appSecret}`;
            const response: AxiosResponse<WxMpAccessTokenResponse> = await axios.get(endpoint);
            if (response.data.access_token) {
                await redis.set(accessTokenKey, response.data.access_token, {
                    EX: response.data.expires_in,
                });
            } else {
                logger.error(`WxMpService getAccessToken error : ${response.data.errcode} : ${response.data.errmsg}`);
            }
        }

        return redis.get(accessTokenKey).then((value: string | null): string => {
            logger.info(`WxMpService getAccessToken value : ${value}`);
            return value as string;
        });
    }

    public async getJsapiTicket(): Promise<string> {
        const redis: RedisClient = await getCacheService().getClient();
        const appId: string = env.wechat.mp.appId;
        const jsapiTicketKey: string = `wx_mp_${appId}_jsapi_ticket`;
        const jsapiTicketValue: string = (await redis.get(jsapiTicketKey)) as string;
        if (isEmpty(jsapiTicketValue)) {
            const endpoint: string = `${HOST}/cgi-bin/ticket/getticket?access_token=${await this.getAccessToken()}&type=jsapi`;
            const response: AxiosResponse<WxMpJsapiTicketResponse> = await axios.get(endpoint);
            if (response.data.ticket) {
                await redis.set(jsapiTicketKey, response.data.ticket, {
                    EX: response.data.expires_in,
                });
            } else {
                logger.error(`WxMpService getJsapiTicket error : ${response.data.errcode} : ${response.data.errmsg}`);
            }
        }
        return redis.get(jsapiTicketKey).then((value: string | null): string => {
            logger.info(`WxMpService getJsapiTicket value : ${value}`);
            return value as string;
        });
    }

    public async createJsapiSignature(url: string): Promise<WxMpJsapiSignature> {
        const appId: string = env.wechat.mp.appId;
        const timestamp: string = String(parseInt(String(new Date().getTime() / 1000), 10));
        const nonceStr: string = Math.random().toString(36).substring(2, 15);
        const jsapiTicket: string = await this.getJsapiTicket();

        logger.info(`WxMpService createJsapiSignature url : ${url}`);

        const array = {
            jsapi_ticket: jsapiTicket,
            timestamp: timestamp,
            nonceStr: nonceStr,
            url: url,
        };
        const keys: string[] = Object.keys(array).sort();
        let string: string = '';
        keys.forEach((key: string): void => {
            // string += `&${key.toLowerCase()}=${getValue(array, key) as string}`;
        });
        string = string.substring(1, string.length);

        const signature: string = crypto.createHash('sha1').update(string).digest('hex');

        logger.info(`WxMpService createJsapiSignature string : ${string}`);
        logger.info(`WxMpService createJsapiSignature signature : ${signature}`);

        return {
            appId: appId,
            nonceStr: nonceStr,
            timestamp: timestamp,
            url: url,
            signature: signature,
        } as WxMpJsapiSignature;
    }

    public async login(): Promise<void> {
        return Promise.resolve();
    }
}

export default (): WxMpService => new WxMpService();
