import { validateAttachmentFile } from '@commons/contract';
import { apiUrl, getToken } from '../api/client';

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

export interface UploadFile {
    name: string;
    size: number;
    type: string;
    file: File;
}

export interface PickOptions {
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

/** 拉起系统文件选择器（浏览器与原生 WebView 均可用） */
function pickViaInput(options: PickOptions): Promise<UploadFile[]> {
    return new Promise((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = options.accept ?? '*/*';
        input.multiple = options.multiple ?? false;
        input.style.display = 'none';
        document.body.appendChild(input);

        let settled = false;
        const finish = (files: UploadFile[]) => {
            if (settled) return;
            settled = true;
            input.remove();
            window.removeEventListener('focus', onWindowFocus);
            resolve(files);
        };

        /**
         * 用户取消时不会触发 change 事件，若不处理会让 Promise 永久挂起，
         * 界面停留在 loading 状态。用窗口重新获得焦点 + 延迟检查来兜底。
         */
        const onWindowFocus = () => {
            setTimeout(() => {
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

        window.addEventListener('focus', onWindowFocus, { once: true });
        input.click();
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
            promptLabelHeader: '选择图片来源',
            promptLabelPhoto: '从相册选择',
            promptLabelPicture: '拍照',
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

/**
 * 上传单个文件。
 * @param onProgress 0-100 的进度回调
 * @returns 服务端返回的附件记录
 */
export function uploadAttachment(fileItem: UploadFile, category = 'other', onProgress?: (percent: number) => void): Promise<unknown> {
    const localError = validateAttachmentFile(fileItem);
    if (localError) return Promise.reject(new Error(localError));

    return new Promise((resolve, reject) => {
        const form = new FormData();
        form.append('file', fileItem.file, fileItem.name);
        form.append('category', category);

        const xhr = new XMLHttpRequest();
        xhr.open('POST', apiUrl('/api/attachments'));
        xhr.withCredentials = true;

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
            const message =
                (payload as { statusMessage?: string; message?: string } | null)?.statusMessage ??
                (payload as { message?: string } | null)?.message ??
                `上传失败（${xhr.status}）`;
            reject(Object.assign(new Error(message), { status: xhr.status, data: payload }));
        });

        xhr.addEventListener('error', () => reject(new Error('网络错误，上传失败')));
        xhr.addEventListener('abort', () => reject(new Error('上传已取消')));

        xhr.send(form);
    });
}
