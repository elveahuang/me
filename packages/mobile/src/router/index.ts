import { createRouter, createWebHistory } from '@ionic/vue-router';
import { RouteRecordRaw } from 'vue-router';
import { checkSessionDecision } from '../api/auth';
import ChatView from '../views/ChatView.vue';
import HomeView from '../views/HomeView.vue';
import LoginView from '../views/LoginView.vue';
import MeView from '../views/MeView.vue';
import RegisterView from '../views/RegisterView.vue';
import TabsView from '../views/TabsView.vue';

const routes: RouteRecordRaw[] = [
    { path: '/', redirect: '/home' },
    { path: '/login', name: 'Login', component: LoginView },
    { path: '/register', name: 'Register', component: RegisterView },
    {
        path: '/tabs',
        component: TabsView,
        children: [
            { path: '', redirect: '/tabs/home' },
            { path: 'home', name: 'Home', component: HomeView },
            { path: 'membership', name: 'MembershipTab', component: () => import('../views/MembershipView.vue') },
            { path: 'me', name: 'Me', component: MeView },
        ],
    },
    { path: '/home', redirect: '/tabs/home' },
    { path: '/membership', redirect: '/tabs/membership' },
    { path: '/me', redirect: '/tabs/me' },
    { path: '/chat/:agentId', name: 'Chat', component: ChatView },
    { path: '/news', name: 'News', component: () => import('../views/NewsView.vue') },
    { path: '/news/:id', name: 'NewsDetail', component: () => import('../views/NewsDetailView.vue') },
    { path: '/notifications', name: 'Notifications', component: () => import('../views/NotificationsView.vue') },
    { path: '/attachments', name: 'Attachments', component: () => import('../views/AttachmentsView.vue') },
    { path: '/wechat-callback', name: 'WechatCallback', component: () => import('../views/WechatCallbackView.vue') },
];

const router = createRouter({
    history: createWebHistory(import.meta.env.BASE_URL),
    routes,
});

router.beforeEach(async (to) => {
    if (to.name === 'Login' || to.name === 'Register' || to.name === 'WechatCallback') {
        if (to.name === 'WechatCallback') return true;
        const { session } = await checkSessionDecision();
        if (session) return '/home';
        return true;
    }
    const { session, offline } = await checkSessionDecision();
    if (!session) {
        // offline 表示探针失败而非确定未登录：带上标记让登录页提示网络问题，
        // 否则弱网冷启动的用户会被静默带到登录页，误以为自己被登出
        return offline ? { path: '/login', query: { network: '1' } } : '/login';
    }
    return true;
});

export default router;
