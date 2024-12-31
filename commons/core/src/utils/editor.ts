import { AiEditorOptions } from 'aieditor';
import { QuillOptions } from 'quill/core/quill';
import { merge } from 'radash';

/**
 * ========================================================================================================================
 * AiEditor
 * https://aieditor.dev/
 * ========================================================================================================================
 */

export const defaultToolbarKeys: string[] = [
    'undo',
    'redo',
    'brush',
    'eraser',
    '|',
    'heading',
    'font-family',
    'font-size',
    '|',
    'bold',
    'italic',
    'underline',
    'strike',
    'link',
    'code',
    'subscript',
    'superscript',
    'hr',
    'todo',
    'emoji',
    '|',
    'highlight',
    'font-color',
    '|',
    'align',
    'line-height',
    '|',
    'bullet-list',
    'ordered-list',
    'indent-decrease',
    'indent-increase',
    'break',
    '|',
    'quote',
    'code-block',
    'table',
];

export const getEditorToolbarKeys = (): string[] => {
    return defaultToolbarKeys;
};

export const defaultEditorOptions: AiEditorOptions = {
    element: '',
    content: '',
    toolbarKeys: getEditorToolbarKeys(),
};

export const getEditorOptions = (options: AiEditorOptions): AiEditorOptions => {
    return merge(defaultEditorOptions, options);
};

/**
 * ========================================================================================================================
 * Quill
 * https://quilljs.com/
 * ========================================================================================================================
 */

export const defaultQuillEditorOptions: QuillOptions = {
    modules: {
        toolbar: true,
    },
    theme: 'snow',
};

export const getQuillEditorOptions = (options: QuillOptions): QuillOptions => {
    return merge(defaultQuillEditorOptions, options);
};
