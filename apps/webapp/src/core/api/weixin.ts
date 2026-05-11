import { get } from '@/core/utils/http';

/**
 * 用户登录
 */
export interface WeiXinMpSignatureApiResult {
    appId: string;
    nonceStr: string;
    timestamp: number;
    url: string;
    signature: string;
}

export interface WeiXinMpSignatureApiParams {
    url: string;
}

export async function weiXinMpSignatureApi(params: WeiXinMpSignatureApiParams): Promise<WeiXinMpSignatureApiResult> {
    return get<WeiXinMpSignatureApiResult>('/api/weixin/mp/signature', params);
}
