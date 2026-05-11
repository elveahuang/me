export interface User {
    id?: number;
    documentId?: string;
    username?: string;
    email?: string;
    provider?: string;
    name?: string;
}

export interface Error {
    status?: number;
    name?: string;
    message?: string;
    details?: string[];
}

export interface AuthLocalResponse {
    jwt?: string;
    user?: User;
    error?: Error;
}

export interface AuthLocalRegisterResponse {
    jwt?: string;
    user?: User;
    error?: {
        status: number;
        name: string;
        message: string;
    };
}
