/**
 * 支付渠道抽象层。
 *
 * 所有渠道实现同一接口，业务代码（订单路由）只面向该接口编程；
 * 新增渠道（支付宝、Stripe 等）时在 registry 注册即可，无需改动订单/会员逻辑。
 */

/** 创建支付的下单上下文 */
export interface PaymentContext {
    /** 商户订单号（out_trade_no） */
    orderNo: string;
    /** 商品描述 */
    description: string;
    /** 支付金额（分） */
    amountCents: number;
    /** 发起支付的浏览器 UA（用于判断微信内 H5/JSAPI 场景） */
    userAgent: string;
    /** 用户关联的微信 openid（已绑定微信公众号登录时存在；JSAPI 支付必需） */
    openid?: string;
    /** 客户端 IP（H5 支付必需） */
    clientIp?: string;
}

/** 下单结果：不同渠道返回不同的支付引导信息 */
export interface CreatePaymentResult {
    /** 渠道标识（与订单 provider 一致） */
    provider: string;
    /**
     * 支付方式：
     * - qrcode：返回 payUrl（Native 二维码链接），前端渲染二维码轮询订单状态
     * - jsapi：返回 jsapiParams（微信内公众号支付），前端用 WeixinJSBridge 拉起
     * - redirect：返回 payUrl（H5 跳转链接）
     * - mock：无需真实支付，直接轮询订单状态即可
     */
    mode: 'qrcode' | 'jsapi' | 'redirect' | 'mock';
    payUrl?: string;
    /** JSAPI 拉起参数（appId/timeStamp/nonceStr/package/signType/paySign） */
    jsapiParams?: {
        appId: string;
        timeStamp: string;
        nonceStr: string;
        package: string;
        signType: 'RSA';
        paySign: string;
    };
}

/** 支付渠道接口 */
export interface PaymentProvider {
    /** 渠道编码（orders.provider） */
    code: string;
    /** 是否可用（凭据已配置） */
    isConfigured(): boolean;
    /** 创建支付 */
    createPayment(ctx: PaymentContext): Promise<CreatePaymentResult>;
    /** 主动查询渠道订单状态（返回 null 表示渠道不可用） */
    queryOrder(orderNo: string): Promise<'SUCCESS' | 'NOTPAY' | 'CLOSED' | 'UNKNOWN' | null>;
    /** 关闭未支付订单 */
    closeOrder(orderNo: string): Promise<void>;
}
