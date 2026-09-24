import { ATTACHMENT_MAX_SIZE_MB, extractApiError, validateAttachmentFile, type AttachmentFileIssue } from '@commons/contract';
import { apiUrl, getToken } from '../api/client';
import { i18n } from '../i18n';

/**
 * 移动端上传通道。
 *
 * 两条路径：
 * - 浏览器 / Web 预览：动态创建 <input type="file">
 * - 原生壳（Capacitor）：调用 @capacitor/camera 打开系统相册/相机
 *
 * 统一返回浏览器 File 对象，调用方无需关心平台差异。
 * 用 XHR 而不是 fetch：fetch 上传时没有进度事件，而附件页需要显示百分比。
 */

/** 上传超时上限：XHR 不设 timeout 会在弱网下永久停在同一进度，但也要给大文件留足时间 */
const UPLOAD_TIMEOUT_MS = 120_000;

interface UploadFile {
    name: string;
    size: number;
    type: string;
    file: File;
}

interface PickOptions {
    /** 是否允许一次选择多个文件（仅文件选择器路径支持） */
    multiple?: boolean;
    /** input accept 属性，如 'image/*' */
    accept?: string;
    /** 来源偏好：photo 会优先调用原生相册/相机 */
    source?: 'auto' | 'photo';
}

/** 是否运行在 Capacitor 原生壳内（WebView 中才有 Capacitor 全局对象） */
export function isNativeShell(): boolean {
    if (typeof window === 'undefined') return false;
    return Boolean((window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.());
}

/** 同一时刻只允许开一个选择器：重复点击会往 body 里再塞一个隐藏 input，各自挂着一个永不返回的 Promise */
let pickerOpen = false;

/** 拉起系统文件选择器（浏览器与原生 WebView 均可用） */
function pickViaInput(options: PickOptions): Promise<UploadFile[]> {
    if (pickerOpen) return Promise.resolve([]);
    return new Promise((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = options.accept ?? '*/*';
        input.multiple = options.multiple ?? false;
        input.style.display = 'none';
        document.body.appendChild(input);

        let settled = false;
        let focusCheck: ReturnType<typeof setTimeout> | undefined;
        const finish = (files: UploadFile[]) => {
            if (settled) return;
            settled = true;
            // 焦点兜底那条 500ms 定时器必须一起清掉，否则它会在选择器已关闭后继续跑
            if (focusCheck !== undefined) clearTimeout(focusCheck);
            pickerOpen = false;
            input.remove();
            window.removeEventListener('focus', onWindowFocus);
            resolve(files);
        };

        /**
         * 用户取消时不会触发 change 事件，若不处理会让 Promise 永久挂起，
         * 界面停留在 loading 状态。优先用 cancel 事件，窗口重新聚焦只是老 WebView 的兜底。
         */
        const onWindowFocus = () => {
            focusCheck = setTimeout(() => {
                if (!input.files?.length) finish([]);
            }, 500);
        };

        input.addEventListener('change', () => {
            const files = Array.from(input.files ?? []).map((file) => ({
                name: file.name,
                size: file.size,
                type: file.type || 'application/octet-stream',
                file,
            }));
            finish(files);
        });

        // 原生壳里打开选择器常常不给本页失焦，focus 事件永远不来；
        // 没有这条就只能等到用户重新聚焦，选择器被直接关到时调用方会永久 await
        input.addEventListener('cancel', () => finish([]));

        window.addEventListener('focus', onWindowFocus, { once: true });
        pickerOpen = true;
        try {
            input.click();
        } catch {
            // 浏览器拒绝打开（例如不在用户手势里）：立即结算，不要把开关永久占住
            finish([]);
        }
    });
}

/** 通过原生相册/相机取图（仅原生壳可用） */
async function pickViaCamera(): Promise<UploadFile[]> {
    try {
        // 动态导入：Web 构建不因此打包原生插件
        const { Camera, CameraResultType, CameraSource } = await import('@capacitor/camera');
        const photo = await Camera.getPhoto({
            quality: 90,
            resultType: CameraResultType.Uri,
            source: CameraSource.Prompt,
            promptLabelHeader: i18n.global.t('common.cameraSourceHeader'),
            promptLabelPhoto: i18n.global.t('common.cameraFromGallery'),
            promptLabelPicture: i18n.global.t('common.cameraTakePhoto'),
        });
        if (!photo.webPath) return [];

        const response = await fetch(photo.webPath);
        const blob = await response.blob();
        const extension = photo.format || 'jpeg';
        const name = `photo-${Date.now()}.${extension}`;
        const file = new File([blob], name, { type: blob.type || `image/${extension}` });
        return [{ name: file.name, size: file.size, type: file.type, file }];
    } catch (error) {
        // 用户取消拍照/选图时插件会抛错；与其他失败区分，返回空数组表示未选择
        const message = error instanceof Error ? error.message : String(error);
        if (/cancel/i.test(message)) return [];
        throw error;
    }
}

/**
 * 选择文件。
 * 原生壳且明确要求图片时优先走相机/相册，其余情况回落文件选择器。
 */
export async function pickFiles(options: PickOptions = {}): Promise<UploadFile[]> {
    if (options.source === 'photo' && isNativeShell()) {
        try {
            const files = await pickViaCamera();
            if (files.length) return files;
            // 相机接口不可用时继续尝试文件选择器
        } catch {
            // 插件异常时降级，不阻塞用户上传
        }
    }
    return pickViaInput(options);
}

/** 契约只回错误代码，文案在这里按当前语言取——commons 里不硬编码中文，英文界面不再露出中文提示 */
function localValidationError(issue: AttachmentFileIssue): string {
    if (issue === 'nameRequired') return i18n.global.t('common.uploadFileNoName');
    if (issue === 'fileEmpty') return i18n.global.t('common.uploadFileEmpty');
    return i18n.global.t('common.uploadFileTooLarge', { maxMb: ATTACHMENT_MAX_SIZE_MB });
}

/**
 * 上传单个文件。
 * @param onProgress 0-100 的进度回调
 * @returns 服务端返回的附件记录
 */
export function uploadAttachment(fileItem: UploadFile, category = 'other', onProgress?: (percent: number) => void): Promise<unknown> {
    const localError = validateAttachmentFile(fileItem);
    if (localError) return Promise.reject(new Error(localValidationError(localError)));

    return new Promise((resolve, reject) => {
        const form = new FormData();
        form.append('file', fileItem.file, fileItem.name);
        form.append('category', category);

        const xhr = new XMLHttpRequest();
        xhr.open('POST', apiUrl('/api/attachments'));
        xhr.withCredentials = true;
        xhr.timeout = UPLOAD_TIMEOUT_MS;

        const token = getToken();
        if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
        // 不手动设置 Content-Type：让浏览器带上 multipart 边界

        xhr.upload.addEventListener('progress', (event) => {
            if (event.lengthComputable && onProgress) {
                onProgress(Math.round((event.loaded / event.total) * 100));
            }
        });

        xhr.addEventListener('load', () => {
            let payload: unknown = null;
            try {
                payload = JSON.parse(xhr.responseText);
            } catch {
                payload = null;
            }
            if (xhr.status >= 200 && xhr.status < 300) {
                resolve(payload);
                return;
            }
            // 与 api() 同一错误归一化：401/402/429 给出站内文案，而不是裸服务端消息或状态码
            const message = extractApiError({ status: xhr.status, data: payload }, i18n.global.t('common.uploadFailed', { status: xhr.status }));
            reject(Object.assign(new Error(message), { status: xhr.status, data: payload }));
        });

        // 网络失败/超时/取消与 api() 约定一致携带 status: 0，便于调用方区分瞬时故障
        xhr.addEventListener('error', () => reject(Object.assign(new Error(i18n.global.t('common.uploadNetworkError')), { status: 0 })));
        xhr.addEventListener('abort', () => reject(Object.assign(new Error(i18n.global.t('common.uploadCancelled')), { status: 0 })));
        xhr.addEventListener('timeout', () =>
            reject(Object.assign(new Error(i18n.global.t('common.uploadTimeout', { seconds: Math.round(UPLOAD_TIMEOUT_MS / 1000) })), { status: 0 })),
        );

        xhr.send(form);
    });
}
