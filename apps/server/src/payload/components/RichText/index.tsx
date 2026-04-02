import { ui } from '@/core/utils/ui.ts';
import { BannerBlock } from '@/payload/blocks/Banner/Component';
import { MediaBlock } from '@/payload/blocks/Media/Component';
import type { BannerBlock as BannerBlockProps, MediaBlock as MediaBlockProps } from '@/payload/payload-types';
import { DefaultNodeTypes, type DefaultTypedEditorState, SerializedBlockNode, SerializedLinkNode } from '@payloadcms/richtext-lexical';
import { RichText as ConvertRichText, JSXConvertersFunction, LinkJSXConverter } from '@payloadcms/richtext-lexical/react';
import React from 'react';

type NodeTypes = DefaultNodeTypes | SerializedBlockNode<MediaBlockProps | BannerBlockProps>;

const internalDocToHref = ({ linkNode }: { linkNode: SerializedLinkNode }) => {
    const { value, relationTo } = linkNode.fields.doc!;
    if (typeof value !== 'object') {
        throw new Error('Expected value to be an object');
    }
    const slug = value.slug;
    return relationTo === 'posts' ? `/posts/${slug}` : `/${slug}`;
};

const jsxConverters: JSXConvertersFunction<NodeTypes> = ({ defaultConverters }) => ({
    ...defaultConverters,
    ...LinkJSXConverter({ internalDocToHref }),
    blocks: {
        banner: ({ node }) => <BannerBlock className='col-start-2 mb-4' {...node.fields} />,
        mediaBlock: ({ node }) => (
            <MediaBlock
                className='col-span-3 col-start-1'
                imgClassName='m-0'
                {...node.fields}
                captionClassName='mx-auto max-w-[48rem]'
                enableGutter={false}
                disableInnerContainer={true}
            />
        ),
    },
});

type Props = {
    data: DefaultTypedEditorState;
    enableGutter?: boolean;
    enableProse?: boolean;
} & React.HTMLAttributes<HTMLDivElement>;

export default function RichText(props: Props) {
    const { className, enableProse = true, enableGutter = true, ...rest } = props;
    return (
        <ConvertRichText
            converters={jsxConverters}
            className={ui(
                'payload-richtext',
                {
                    container: enableGutter,
                    'max-w-none': !enableGutter,
                    'prose md:prose-md dark:prose-invert mx-auto': enableProse,
                },
                className,
            )}
            {...rest}
        />
    );
}
