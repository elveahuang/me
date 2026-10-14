<template>
    <EditorContent :editor="editor" />
</template>

<script lang="ts" setup>
import { EditorContent, useEditor } from '@tiptap/vue-3';
import StarterKit from '@tiptap/starter-kit';

const editor = useEditor({
    content: `<p>I'm running Tiptap with Vue.js. 🎉</p>`,
    extensions: [StarterKit as any],
});
</script>
