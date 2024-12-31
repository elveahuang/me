/**
 * 检查当前用户是否拥有任意一个角色或者权限
 * @param requireAuthority 所需权限
 * @param currentAuthority 拥有权限
 */
export const hasAuthority = (requireAuthority: string | Array<string>, currentAuthority: string | Array<string>): boolean => {
    if (!requireAuthority) {
        return true;
    }
    // 数组处理
    if (Array.isArray(requireAuthority)) {
        if (Array.isArray(currentAuthority)) {
            if (currentAuthority.some((item) => requireAuthority.includes(item))) {
                return true;
            }
        } else if (requireAuthority.includes(currentAuthority)) {
            return true;
        }
        return false;
    }
    // 字符串处理
    if (typeof requireAuthority === 'string') {
        if (Array.isArray(currentAuthority)) {
            if (currentAuthority.some((item) => requireAuthority === item)) {
                return true;
            }
        } else if (requireAuthority === currentAuthority) {
            return true;
        }
        return false;
    }
    throw new Error('unsupported parameters');
};
