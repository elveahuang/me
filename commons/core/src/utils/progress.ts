import NProgress from 'nprogress';
import 'nprogress/nprogress.css';

/**
 * 打开进度条动画
 */
export const progressStart = (): void => {
    NProgress.start();
};

/**
 * 关闭进度条动画
 */
export const progressDone = (): void => {
    NProgress.done();
};

/**
 * 设置进度条
 */
export const setupProgress = async (): Promise<void> => {
    NProgress.configure({ showSpinner: false });
};
