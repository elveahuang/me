import RichText from '@/payload/components/RichText';
import { CTABlock } from './CTABlock';
import { FeaturesBlock } from './FeaturesBlock';
import { GalleryBlock } from './GalleryBlock';
import { HeroBlock } from './HeroBlock';
import { TestimonialsBlock } from './TestimonialsBlock';

interface BlockData {
    blockType: string;
    [key: string]: any;
}

interface BlockRendererProps {
    blocks: BlockData[];
}

function ContentBlock({ columns }: { columns?: Array<{ size: string; richText?: any }> }) {
    if (!columns || columns.length === 0) return null;

    const gridCols = columns.length === 1 ? 'grid-cols-1' : columns.length === 2 ? 'md:grid-cols-2' : 'md:grid-cols-3';

    return (
        <section className='px-4 py-12'>
            <div className={`mx-auto grid max-w-6xl gap-8 ${gridCols}`}>
                {columns.map((column, index) => (
                    <div key={index} className={`${column.size === 'full' ? 'md:col-span-2' : ''}`}>
                        {column.richText && <RichText data={column.richText} />}
                    </div>
                ))}
            </div>
        </section>
    );
}

function MediaBlock({ media, caption }: { media?: { url: string; alt?: string }; caption?: string }) {
    if (!media) return null;

    return (
        <section className='px-4 py-12'>
            <div className='mx-auto max-w-4xl'>
                <img src={media.url} alt={media.alt || caption || ''} className='w-full rounded-lg' />
                {caption && <p className='mt-4 text-center text-gray-600 dark:text-gray-400'>{caption}</p>}
            </div>
        </section>
    );
}

function BannerBlock({ content, style }: { content?: any; style?: 'info' | 'warning' | 'success' | 'error' }) {
    const styleClasses: Record<string, string> = {
        info: 'bg-blue-50 border-blue-500 text-blue-800',
        warning: 'bg-yellow-50 border-yellow-500 text-yellow-800',
        success: 'bg-green-50 border-green-500 text-green-800',
        error: 'bg-red-50 border-red-500 text-red-800',
    };

    return (
        <section className='px-4 py-4'>
            <div className={`mx-auto max-w-4xl rounded border-l-4 p-4 ${styleClasses[style || 'info']}`}>{content && <RichText data={content} />}</div>
        </section>
    );
}

function CodeBlock({ language, code }: { language?: string; code?: string }) {
    if (!code) return null;

    return (
        <section className='px-4 py-12'>
            <div className='mx-auto max-w-4xl'>
                <pre className='overflow-x-auto rounded-lg bg-gray-900 p-6 text-gray-100'>
                    <code className={language ? `language-${language}` : ''}>{code}</code>
                </pre>
            </div>
        </section>
    );
}

export function BlockRenderer({ blocks }: BlockRendererProps) {
    if (!blocks || blocks.length === 0) return null;

    return (
        <>
            {blocks.map((block, index) => {
                switch (block.blockType) {
                    case 'hero':
                        return <HeroBlock key={index} {...block} />;
                    case 'cta':
                        return <CTABlock key={index} {...block} />;
                    case 'features':
                        return <FeaturesBlock key={index} {...block} />;
                    case 'testimonials':
                        return <TestimonialsBlock key={index} {...block} />;
                    case 'gallery':
                        return <GalleryBlock key={index} {...block} />;
                    case 'content':
                        return <ContentBlock key={index} {...block} />;
                    case 'mediaBlock':
                        return <MediaBlock key={index} {...block} />;
                    case 'banner':
                        return <BannerBlock key={index} {...block} />;
                    case 'code':
                        return <CodeBlock key={index} {...block} />;
                    default:
                        console.warn(`Unknown block type: ${block.blockType}`);
                        return null;
                }
            })}
        </>
    );
}
