import { useI18nExternal } from '@commons/core/i18n';
import { isEmpty } from 'lodash-es';

export class Menu {
    /**
     * 菜单标识
     */
    key: string;
    /**
     * 菜单多语言文本
     */
    label?: string;
    /**
     * 菜单标题
     */
    title?: string;
    /**
     * 菜单图标
     */
    icon?: string;
    /**
     * 菜单链接
     */
    path?: string;
    /**
     * 菜单是否需要检查权限
     */
    authenticated?: boolean;
    /**
     * 菜单是否启用
     */
    enabled?: boolean;
    /**
     * 菜单对应权限
     */
    authorities?: string | string[] | null | undefined;
    /**
     * 子菜单
     */
    items?: Menu[];
}

export const getMenuItems = (menus: Menu[]): Menu[] => {
    return menus
        .filter((menu: Menu): boolean => menu.enabled === true)
        .map((m: Menu) => {
            return getMenuItem(m);
        });
};

export function getMenuItem(menu: Menu): Menu {
    const { t } = useI18nExternal();
    menu.title = isEmpty(menu?.title) ? t(menu.label) : menu?.title;
    if (menu.items && menu.items.length && menu.items.length > 0) {
        menu.items = getMenuItems(menu.items);
    }
    return menu;
}

export const getRootMenuKeys = (menus: Menu[]): string[] => {
    if (menus?.length > 0) {
        return menus.map((menu: Menu) => menu.key);
    }
    return [];
};

export const getFirstMenuKey = (menus: Menu[], path: string): string[] => {
    const paths: string[] = [];
    if (menus?.length > 0) {
        menus.forEach((menu: Menu): void => {
            if (menu?.items?.length > 0) {
                menu?.items?.forEach((children: Menu): void => {
                    if (children.path === path) {
                        paths.push(menu.key);
                    }
                });
            } else {
                if (menu.path === path) {
                    paths.push(menu.key);
                }
            }
        });
    }
    return paths;
};

export const getMatchMenuKey = (menus: Menu[], path: string): string[] => {
    const paths: string[] = [];
    if (menus?.length > 0) {
        menus.forEach((menu: Menu): void => {
            if (menu?.items?.length > 0) {
                menu?.items?.forEach((children: Menu): void => {
                    if (children.path === path) {
                        paths.push(children.key);
                    }
                });
            } else {
                if (menu.path === path) {
                    paths.push(menu.key);
                }
            }
        });
    }
    return paths;
};
