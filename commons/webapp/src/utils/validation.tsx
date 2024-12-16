import { checkUsernameApi } from '@commons/core/api/app/user.ts';
import { useI18nExternal } from '@commons/core/i18n';
import { Key, R } from '@commons/core/types';
import { RuleObject } from 'antd/es/form';
import { isEmpty } from 'radash';

export const checkUsername = async (rule: RuleObject, value: string, params: { id?: Key } = {}): Promise<void> => {
    const { t } = useI18nExternal();
    if (!isEmpty(value)) {
        const result: R<boolean> = await checkUsernameApi({ username: value, id: params.id || 0 });
        if (result.code === 200 && result.data === true) {
            return Promise.resolve();
        }
    }
    return Promise.reject(new Error(rule.message as string));
};
