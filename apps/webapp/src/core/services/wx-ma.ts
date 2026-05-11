import env from '@/core/env';
import logger from '@/core/utils/logger';
import axios, { AxiosResponse } from 'axios';
import { isEmpty } from 'es-toolkit/compat';

export const HOST: string = 'https://api.weixin.qq.com';

export interface WxMaAuthResponse {
    session_key: string;
    unionid: string;
    openid: string;
    errcode: string;
    errmsg: string;
}

export class WxMaService {
    public async auth(code: string): Promise<WxMaAuthResponse> {
        if (!isEmpty(code)) {
            const appId: string = env.wechat.ma.appId;
            const appSecret: string = env.wechat.ma.appSecret;
            logger.info(`WxMpService auth for : ${appId}`);
            const endpoint: string = `${HOST}/sns/jscode2session?grant_type=authorization_code&appid=${appId}&secret=${appSecret}&js_code=${code}`;
            const response: AxiosResponse<WxMaAuthResponse> = await axios.get(endpoint);
            if (response.data.openid) {
                return response.data;
            } else {
                logger.error(`WxMaService auth error : ${response.data.errcode} : ${response.data.errmsg}`);
            }
        }
        return Promise.reject();
    }
}

export function getWxMaService(): WxMaService {
    return new WxMaService();
}
