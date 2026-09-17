import { validateAttachmentFile } from '@commons/contract';
import { apiUrl, getToken } from '../api/client';

/**
 * 移动端上传通道。
 *
 * 两条路径：
 * - 浏览器 / 开发环境：动态创建 <input type="file">，走 XHR 以获得上传进度
 * - 原生壳：交给 @capacitor/camera 的相册选择（图片）或 file input 兜底
 *
 * 统一返回浏览器 File 对象，调用方无需关心平台差异。
 * 用 XHR 而不是 fetch：fetch 在移动端上传大文件时没有进度事件，
 * 而附件页需要显示百分比进度。
 */

export interface UploadFile {
    name: string;
    size: number;
    type: string;
    file: File;
}

/** 拉起系统文件选择器（浏览器与原生 WebView 均可用） */
export function pickFiles(options: { accept?: string; multiple?: boolean } = {}): Promise<UploadFile[]> {
    return new Promise((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = options.accept ?? '*/*';
        input.multiple = options.multiple ?? false;
        input.style.display = 'none';
        document.body.appendChild(input);

        const cleanup = () => {
            input.remove();
        };

        input.addEventListener('change', () => {
            const files = Array.from(input.files ?? []).map((file) => ({
                name: file.name,
                size: file.size,
                type: file.type || 'application/octet-stream',
                file,
            }));
            cleanup();
            resolve(files);
        });

        // 用户取消时不会触发 change；用 focus 回归判断取消，避免 Promise 永久挂起
        window.addEventListener(
            'focus',
            () => {
                setTimeout(() => {
                    if (!input.files?.length) {
                        cleanup();
                        resolve([]);
                    }
                }, 300);
            },
            { once: true },
        );

        input.click();
    });
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
