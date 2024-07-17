import { useAppSelector } from '@commons/core/store';
import { getEditorOptions } from '@commons/core/utils/editor.ts';
import { Locale } from '@commons/core/utils/locale.ts';
import { AiEditor, AiEditorOptions } from 'aieditor';
import 'aieditor/dist/style.css';
import { isFunction } from 'lodash-es';
import { MutableRefObject, Ref, forwardRef, useEffect, useImperativeHandle, useRef } from 'react';

export type AEditorProps = {
    options?: any;
    content?: string;
    onReady?: () => void;
    onChange?: (content: string, editor: AiEditor) => void;
};

export type AEditorRef = {
    getContent: () => string;
};

export const AEditor = forwardRef((props: AEditorProps, ref: Ref<AEditorRef>) => {
    const editorDivRef: MutableRefObject<HTMLDivElement> = useRef<HTMLDivElement>();
    const editorRef: MutableRefObject<AiEditor> = useRef<AiEditor>();
    const { dark, locale } = useAppSelector();
    const { content = '', onChange } = props;
    const getContent = (): string => {
        if (editorRef.current) {
            return editorRef.current.isEmpty() ? '' : editorRef.current.getHtml();
        }
        return '';
    };
    useEffect((): void => {
        if (!editorDivRef.current) {
            return;
        }
        if (!editorRef.current) {
            const options: AiEditorOptions = {
                element: editorDivRef.current as Element,
                content: content,
                theme: dark ? 'dark' : 'light',
                lang: locale === Locale.ZH_CN ? 'zh' : 'en',
                onChange: (editor: AiEditor): void => {
                    if (isFunction(onChange)) {
                        onChange(getContent(), editor);
                    }
                },
            } as AiEditorOptions;
            editorRef.current = new AiEditor(getEditorOptions(options));
        }
    }, []);

    useImperativeHandle(ref, (): AEditorRef => {
        return {
            getContent: (): string => getContent(),
        };
    });

    return (
        <div className="editor">
            <div ref={editorDivRef} className="ai-editor" />
        </div>
    );
});
AEditor.displayName = 'AEditor';
export default AEditor;
