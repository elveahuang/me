import { ActionState } from '@/core/types/action';
import { Credentials } from '@/core/types/user';

export async function loginAction(_: ActionState, value: Credentials): Promise<ActionState> {
    try {
        console.log('loginAction...');
        return { status: 'success' };
    } catch (e) {
        return { status: 'failed' };
    }
}

export async function logoutAction(_: ActionState): Promise<ActionState> {
    try {
        console.log('loginAction...');
        return { status: 'success' };
    } catch (e) {
        return { status: 'failed' };
    }
}
