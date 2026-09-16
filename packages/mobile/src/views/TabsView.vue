<script setup lang="ts">
import { IonIcon, IonLabel, IonRouterOutlet, IonTabBar, IonTabButton, IonTabs } from '@ionic/vue';
import { cardOutline, gridOutline, personOutline } from 'ionicons/icons';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();
</script>

<template>
    <ion-tabs>
        <ion-router-outlet />
        <template v-slot:bottom>
            <ion-tab-bar class="border-t" style="border-color: var(--line)">
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
        </template>
    </ion-tabs>
</template>
