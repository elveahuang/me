/**
 * webapp 服务端地址。
 * - 浏览器/Ionic dev：默认 http://localhost:3000
 * - Capacitor 打包：构建时设置 VITE_API_URL（或改这里的默认值）
 */
export const API_BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';
