export interface ActionState {
    status: 'idle' | 'progress' | 'success' | 'failed' | 'invalid';
}

export const defaultActionState: ActionState = {
    status: 'idle',
};
