import { EditorContent, Editor as TipTapEditor, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { JSX } from 'react';

export function Editor(): JSX.Element {
    const editor: TipTapEditor = useEditor({
        extensions: [StarterKit],
        content: '<p>Hello World!</p>',
    });

    return (
        <>
            <EditorContent editor={editor} />
        </>
    );
}

export default Editor;
