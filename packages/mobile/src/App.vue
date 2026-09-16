<template>
    <k-provider theme="parent">
        <ion-app>
            <ion-router-outlet />
        </ion-app>
    </k-provider>
</template>

<script setup lang="ts">
import { IonApp, IonRouterOutlet } from '@ionic/vue';
import { kProvider } from 'konsta/vue';
</script>
