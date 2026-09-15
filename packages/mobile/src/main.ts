import { createApp } from 'vue';
import App from './App.vue';
import router from './router';

import { IonicVue } from '@ionic/vue';

/* Core CSS required for Ionic components to work properly */
import '@ionic/vue/css/core.css';

/* Basic CSS for apps built with Ionic */
import '@ionic/vue/css/normalize.css';
import '@ionic/vue/css/structure.css';
import '@ionic/vue/css/typography.css';

/* Optional CSS utils that can be commented out */
import '@ionic/vue/css/display.css';
import '@ionic/vue/css/flex-utils.css';
import '@ionic/vue/css/float-elements.css';
import '@ionic/vue/css/padding.css';
import '@ionic/vue/css/text-alignment.css';
import '@ionic/vue/css/text-transformation.css';

/* Ionic 深色主题（class 策略，由 useTheme 切换 ion-palette-dark） */
import '@ionic/vue/css/palettes/dark.class.css';

import { i18n } from './i18n';

/* 共享设计令牌 + Tailwind + Ionic 变量映射 */
import './theme/theme.css';
import './theme/variables.css';

import { initTheme } from './composables/useTheme';

// 首屏渲染前先把主题写到 <html>，避免闪色
initTheme();

const app = createApp(App).use(IonicVue).use(router).use(i18n);

router.isReady().then(() => {
    app.mount('#app');
});
