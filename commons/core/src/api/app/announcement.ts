import { Announcement } from '@commons/core/types/announcement';
import { PageParams, PageResult, R } from '@commons/core/types/common';
import { post } from '@commons/core/utils/http';

/**
 * 获取公告资讯列表
 */
export const announcementListApi = (params: PageParams): Promise<R<PageResult<Announcement>>> => {
    return post<R<PageResult<Announcement>>>('/api/announcement/list', params);
};

/**
 * 获取公告资讯详情
 */
export interface AnnouncementDetailsApiParams {
    id: number;
}

export const announcementDetailsApi = (params: AnnouncementDetailsApiParams): Promise<R<Announcement>> => {
    return post<R<Announcement>>('/api/v1/announcement/details', params);
};
