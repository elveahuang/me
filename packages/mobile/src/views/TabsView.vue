<script setup lang="ts">
import { IonIcon, IonLabel, IonPage, IonRouterOutlet, IonTabBar, IonTabButton, IonTabs } from '@ionic/vue';
import { cardOutline, gridOutline, personOutline } from 'ionicons/icons';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();
</script>

<template>
    <!-- ion-tabs 必须包在 ion-page 内，否则外层 router-outlet 找不到页面根元素，切换 tab 时报错 -->
    <ion-page>
        <ion-tabs>
            <ion-router-outlet />
            <ion-tab-bar slot="bottom" class="border-t" style="border-color: var(--line)">
                <ion-tab-button tab="home" href="/tabs/home">
                    <ion-icon :icon="gridOutline" />
                    <ion-label>{{ t('nav.home') }}</ion-label>
                </ion-tab-button>
                <ion-tab-button tab="membership" href="/tabs/membership">
                    <ion-icon :icon="cardOutline" />
                    <ion-label>{{ t('nav.pricing') }}</ion-label>
                </ion-tab-button>
                <ion-tab-button tab="me" href="/tabs/me">
                    <ion-icon :icon="personOutline" />
                    <ion-label>{{ t('nav.me') }}</ion-label>
                </ion-tab-button>
            </ion-tab-bar>
        </ion-tabs>
    </ion-page>
</template>
