import { alertController, toastController } from '@ionic/vue';
import { useI18n } from 'vue-i18n';

/**
 * 用 Ionic 弹窗替代原生 window.confirm / window.alert。
 *
 * 原生对话框在 Capacitor 的 WKWebView / Android WebView 里样式不统一、会阻塞 JS，
 * 部分构建下 confirm 甚至直接返回 undefined，导致「确认删除」永远走不下去。
 * 这里统一走 Ionic 的控制器，取消/确认文案随当前语言走。
 */
export function useDialog() {
    const { t } = useI18n();

    /** 同一时刻只保留一个确认框：连点删除会叠出两层，用户确认第一层后第二层仍悬在页面上等答复 */
    let confirming = false;

    /** 返回用户是否点击了确认 */
    function confirmDialog(message: string): Promise<boolean> {
        if (confirming) return Promise.resolve(false);
        confirming = true;
        return new Promise((resolve) => {
            // 结算必须成对地把 confirming 放回去，否则一次异常就把后续所有确认框永久锁死
            const settle = (confirmed: boolean) => {
                confirming = false;
                resolve(confirmed);
            };
            // 按钮 handler 只记录意向，resolve 统一等 onDidDismiss：
            // 点遮罩/滑动关闭等非按钮途径不会执行 handler，只靠 handler 会让 await 方（如删除确认）永久挂起
            let confirmed = false;
            void alertController
                .create({
                    message,
                    buttons: [
                        { text: t('common.cancel'), role: 'cancel' },
                        { text: t('common.confirm'), handler: () => (confirmed = true) },
                    ],
                })
                .then(async (alert) => {
                    await alert.present();
                    await alert.onDidDismiss();
                    settle(confirmed);
                })
                // 原先没有这一条：create()/present() 抛错（overlay 容器缺失、连续快速创建）时
                // 上面的链走不到 settle，await 方永久卡住——退出登录/删除变成点了没反应
                .catch(() => settle(false));
        });
    }

    /** 轻量提示，自动消失 */
    function toast(message: string, duration = 2000): void {
        void toastController.create({ message, duration, position: 'bottom' }).then((toastEl) => toastEl.present());
    }

    return { confirmDialog, toast };
}
