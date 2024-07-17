import { compareSync, hashSync } from 'bcrypt';

export const compare = async (old: string, repeat: string): Promise<boolean> => {
    return compareSync(old, repeat);
};

export const encrypt = (password: string) => {
    return hashSync(password, 10);
};
