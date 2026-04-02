import { getClientSideURL } from './getURL';

export function getMediaUrl(url: string | null | undefined, cacheTag?: string | null): string {
    if (!url) return '';
    if (cacheTag && cacheTag !== '') {
        cacheTag = encodeURIComponent(cacheTag);
    }
    if (url.startsWith('http://') || url.startsWith('https://')) {
        return cacheTag ? `${url}?${cacheTag}` : url;
    }
    const baseUrl = getClientSideURL();
    return cacheTag ? `${baseUrl}${url}?${cacheTag}` : `${baseUrl}${url}`;
}
