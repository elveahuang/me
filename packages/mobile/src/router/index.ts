import { createRouter, createWebHistory } from '@ionic/vue-router';
import { RouteRecordRaw } from 'vue-router';
import { fetchSession } from '../api/auth';
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
    { path: '/wechat-callback', name: 'WechatCallback', component: () => import('../views/WechatCallbackView.vue') },
];

const router = createRouter({
    history: createWebHistory(import.meta.env.BASE_URL),
    routes,
});

router.beforeEach(async (to) => {
    if (to.name === 'Login' || to.name === 'Register' || to.name === 'WechatCallback') {
        if (to.name === 'WechatCallback') return true;
        const session = await fetchSession();
        if (session) return '/home';
        return true;
    }
    const session = await fetchSession();
    if (!session) return '/login';
    return true;
});

export default router;
