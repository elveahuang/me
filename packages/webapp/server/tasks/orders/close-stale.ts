import { closeStalePendingOrders } from '../../utils/billing';

/**
 * 定时关闭超时未支付的 pending 订单。
 *
 * 此前只有「用户轮询订单详情」会惰性触发清理，渠道不可达时订单会长期悬挂在 pending，
 * 既污染对账口径也占用渠道侧订单号。任务本身幂等（只关渠道确认 NOTPAY/CLOSED 的单），
 * 多实例部署下重复执行不会造成状态错乱。
 *
 * 注册见 nuxt.config.ts 的 nitro.scheduledTasks。
 */
export default defineTask({
    meta: {
        name: 'orders:close-stale',
        description: '关闭超过订单有效期（2 小时）仍未支付的订单',
    },
    async run() {
        // 阈值统一走 closeStalePendingOrders 默认的 ORDER_TTL_MS，
        // 更早关单会让仍在有效期内、尚未扫码的二维码在渠道侧失效
        const closedCount = await closeStalePendingOrders();
        return { result: { closedCount } };
    },
});
