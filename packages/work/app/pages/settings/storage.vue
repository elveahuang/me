<script setup lang="ts">
import { useI18n } from 'vue-i18n';

/**
 * 存储配置子页：附件上传用的 S3 协议对象桶（RustFS / MinIO / AWS S3）。
 *
 * 表单与列表都在 `AdminSettingsStorage` 里（fork 时带过来却一直没有入口的组件），
 * 这一页只是把它接进设置区导航——聊天附件上传与下载链接都读这里的默认配置。
 */
const { t } = useI18n();
</script>

<template>
    <div class="space-y-5">
        <WorkSettingsNav />

        <div class="app-page-header">
            <div>
                <h1 class="app-page-title text-strong">{{ t('settings.navStorage') }}</h1>
                <p class="app-page-subtitle">{{ t('settings.storageSubtitle') }}</p>
            </div>
        </div>

        <AdminSettingsStorage />

        <!--
            数据备份放在这一页而不是单独开一个导航项：它和上面是同一个问题（数据存在哪、怎么带走），
            而 8 个设置子项在窄屏已经要靠横向滚动才排得下。
            用原生 <a download> 而不是 fetch + Blob：一份备份是整库 JSON，把它先读进页面内存再喂回
            浏览器毫无意义，还会让「点了没反应」变成「转圈十几秒」。
        -->
        <section class="app-card space-y-2 p-4 sm:p-5">
            <h2 class="text-sm font-black"><AppIcon name="database-outline" :size="15" class="mr-1 inline" />{{ t('settings.dataBackupTitle') }}</h2>
            <p class="text-faint text-xs">{{ t('settings.dataBackupHint') }}</p>
            <div class="pt-1">
                <a href="/api/export" download class="app-btn app-btn-outline">
                    <AppIcon name="download-outline" :size="15" />
                    <span>{{ t('settings.dataBackupAction') }}</span>
                </a>
            </div>
            <p class="text-faint text-[11px]">{{ t('settings.dataBackupNote') }}</p>
        </section>
    </div>
</template>
