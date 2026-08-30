/**
 * webapp 服务端地址。
 * - Web/模拟器：默认 http://localhost:3000
 * - 真机调试：启动时设置 EXPO_PUBLIC_API_URL=http://<电脑局域网 IP>:3000
 */
export const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';
