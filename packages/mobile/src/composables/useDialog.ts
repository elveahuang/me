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

    /** 返回用户是否点击了确认 */
    function confirmDialog(message: string): Promise<boolean> {
        return new Promise((resolve) => {
            void alertController
                .create({
                    message,
                    buttons: [
                        { text: t('common.cancel'), role: 'cancel', handler: () => resolve(false) },
                        { text: t('common.confirm'), handler: () => resolve(true) },
                    ],
                })
                .then((alert) => alert.present());
        });
    }

    /** 轻量提示，自动消失 */
    function toast(message: string, duration = 2000): void {
        void toastController.create({ message, duration, position: 'bottom' }).then((toastEl) => toastEl.present());
    }

    return { confirmDialog, toast };
}
