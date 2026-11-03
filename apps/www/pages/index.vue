<script setup lang="ts">
const message = 'Hello, Void + Vue!';
</script>

<template>
    <main class="hello">
        <h1>{{ message }}</h1>
    </main>
</template>

<style scoped>
.hello {
    display: flex;
    min-height: 100vh;
    align-items: center;
    justify-content: center;
    font-family: system-ui, sans-serif;
}
</style>
