/**
 * 核心版本号
 */
export const applicationVersion = '0.0.1';

/**
 * 微信公众号单点登录链接
 */
export const weChatOAuthUrl = `https://open.weixin.qq.com/connect/oauth2/authorize?appid={0}&redirect_uri={1}&response_type=code&scope=snsapi_base&state=STATE#wechat_redirect`;

/**
 * 企业微信单点登录链接
 */
export const weComOAuthUrl = `https://open.weixin.qq.com/connect/oauth2/authorize?appid={0}&redirect_uri={1}&response_type=code&scope={2}&state=STATE&agentid={3}#wechat_redirect`;

/**
 * 飞书单点登录链接
 */
export const larkOAuthUrl = `https://open.feishu.cn/open-apis/authen/v1/index?app_id={0}&redirect_uri={1}`;

/**
 * 钉钉单点登录链接
 */
export const dingtalkOAuthUrl = `https://login.dingtalk.com/oauth2/auth?redirect_uri={0}&response_type=code&client_id={1}&scope=openid&prompt=consent`;
