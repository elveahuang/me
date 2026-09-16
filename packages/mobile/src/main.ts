import App from '@/App.vue';
import { initTheme } from '@/composables/useTheme';
import { i18n } from '@/i18n';
import router from '@/router';
import '@/theme/theme.css';
import { IonicVue } from '@ionic/vue';
import { createApp } from 'vue';

// 首屏渲染前先把主题写到 <html>，避免闪色
initTheme();

const app = createApp(App).use(IonicVue).use(router).use(i18n);

router.isReady().then(() => {
    app.mount('#app');
});
