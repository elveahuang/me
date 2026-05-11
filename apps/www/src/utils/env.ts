declare type Environment = {
    base: string;
};

export const env: Environment = {
    base: import.meta.env.VITE_APP_BASE ?? '/',
};

export default env;
