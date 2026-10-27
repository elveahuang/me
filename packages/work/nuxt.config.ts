import { fileURLToPath } from 'node:url';
import { defineNuxtConfig } from 'nuxt/config';

export default defineNuxtConfig({
    compatibilityDate: '2026-06-30',
    modules: ['@nuxt/icon', '@nuxt/ui', '@comark/nuxt'],
    devtools: { enabled: false },
    // 本包是 ESM（package.json 的 "type": "module"），配置里的 `__dirname` 不存在
    css: [fileURLToPath(new URL('app/assets/css/main.css', import.meta.url))],
    /**
     * work 没有鉴权层，数据全部是单主的私人内容，因此只监听回环地址。
     *
     * 生产不能用 `node .output/server/index.mjs --host 127.0.0.1`：nitro 的 node preset 只读
     * `NITRO_HOST`/`HOST` 环境变量，不解析命令行参数，带 `--host` 照样绑到 0.0.0.0（已实测）。
     * 正确写法是 `NITRO_HOST=127.0.0.1 node .output/server/index.mjs`；
     * `server/utils/env-guard.ts` 会在生产启动时把「没设回环绑定」当成拒绝启动的问题。
     */
    devServer: {
        host: '127.0.0.1',
        port: 3001,
    },
    app: {
        head: {
            viewport: 'width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content',
        },
    },
    alias: {
        '@commons': fileURLToPath(new URL('../commons/src', import.meta.url)),
    },
    runtimeConfig: {
        // 这里刻意不再放 deepseekApiKey：全应用的模型供应商都配在数据库里（设置 → 模型供应商），
        // 默认供应商的自动 seed 由 server/utils/providers.ts 的 envDeepseekKey() 直接读
        // NUXT_DEEPSEEK_API_KEY / DEEPSEEK_API_KEY。原先这条 runtimeConfig 只有孤儿端点
        // /api/completion 在读，等于给同一个 Key 开了第二个「硬编码 DeepSeek、绕过数据库」的口径。
        public: {
            siteSettings: {
                siteTitle: 'WORK',
                defaultLocale: 'zh-CN',
                themeMode: 'system',
                themeBrand: 'green',
            },
        },
    },
    nitro: {
        /**
         * 自定义错误处理器只为给响应补 `data.code` / `data.requestId`；它同步执行，
         * 能赶在默认处理器序列化之前改到 `error.data`（`error` hook 是异步并行，来不及）。
         */
        errorHandler: '~~/server/error.ts',
        experimental: {
            tasks: true,
        },
        /**
         * 任务不在 cron 里写「每天几点」：croner 按进程本地时区解释表达式，容器几乎都是 UTC，
         * 那样会把北京时间的钟点整体推后 8 小时。时刻口径一律落在数据库里由 `work-day.ts`/`work-schedule.ts`
         * 算成绝对时刻，cron 只管「多久醒一次」。
         *
         * `schedules:run-due`：每分钟认领到期的定时任务（server/tasks/schedules/run-due.ts）。
         * 没有到期行的唤醒不产生任何外呼；精度就是「最多晚几十秒」，本机工作台够用。
         */
        scheduledTasks: {
            '* * * * *': 'schedules:run-due',
        },
    },
    fonts: {
        providers: {
            google: false,
            googleicons: false,
        },
    },
    icon: {
        serverBundle: {
            collections: ['mdi'],
        },
    },
    vite: {
        optimizeDeps: {
            exclude: ['@nuxtjs/mdc'],
        },
    },
});
