import App from '@/App.vue';
import { initTheme } from '@/composables/useTheme';
import { i18n, initMobileLocale } from '@/i18n';
import router from '@/router';
import '@/theme/main.css';
import { IonicVue } from '@ionic/vue';
import { createApp } from 'vue';

// 首屏渲染前先把主题写到 <html>，避免闪色
initTheme();
// 同样在挂载前把 <html lang> 对齐到持久化的语言偏好
initMobileLocale();

const app = createApp(App).use(IonicVue).use(router).use(i18n);

router.isReady().then(() => {
    app.mount('#app');
});
