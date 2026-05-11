'use client';

import { useState } from 'react';

interface GalleryImage {
    image: {
        url: string;
        alt?: string;
        width?: number;
        height?: number;
    };
    caption?: string;
    alt?: string;
}

interface GalleryBlockProps {
    title?: string;
    images: GalleryImage[];
    layout?: 'grid' | 'masonry' | 'carousel';
    columns?: '2' | '3' | '4' | '5';
    enableLightbox?: boolean;
    enableCaption?: boolean;
    aspectRatio?: 'auto' | '1:1' | '4:3' | '16:9' | '3:2';
}

const aspectRatioClasses: Record<string, string> = {
    auto: '',
    '1:1': 'aspect-square',
    '4:3': 'aspect-4/3',
    '16:9': 'aspect-video',
    '3:2': 'aspect-3/2',
};

const columnClasses: Record<string, string> = {
    '2': 'md:grid-cols-2',
    '3': 'md:grid-cols-3',
    '4': 'md:grid-cols-2 lg:grid-cols-4',
    '5': 'md:grid-cols-3 lg:grid-cols-5',
};

export function GalleryBlock({
    title,
    images,
    layout = 'grid',
    columns = '3',
    enableLightbox = true,
    enableCaption = true,
    aspectRatio = 'auto',
}: GalleryBlockProps) {
    const [lightboxImage, setLightboxImage] = useState<GalleryImage | null>(null);

    return (
        <section className='px-4 py-16'>
            <div className='mx-auto max-w-6xl'>
                {title && <h2 className='mb-12 text-center text-3xl font-bold md:text-4xl'>{title}</h2>}

                <div
                    className={
                        layout === 'grid'
                            ? `grid gap-4 ${columnClasses[columns]}`
                            : layout === 'masonry'
                              ? `columns-1 md:columns-${columns} gap-4`
                              : 'flex snap-x snap-mandatory gap-4 overflow-x-auto pb-4'
                    }
                >
                    {images.map((item, index) => (
                        <div
                            key={index}
                            className={`${
                                layout === 'carousel' ? 'w-80 flex-shrink-0 snap-start' : layout === 'masonry' ? 'mb-4 break-inside-avoid' : ''
                            } group relative overflow-hidden rounded-lg ${enableLightbox ? 'cursor-pointer' : ''}`}
                            onClick={() => enableLightbox && setLightboxImage(item)}
                        >
                            <img
                                src={item.image.url}
                                alt={item.alt || item.caption || item.image.alt || `Gallery image ${index + 1}`}
                                className={`w-full object-cover transition-transform duration-300 group-hover:scale-105 ${
                                    aspectRatio !== 'auto' && layout !== 'masonry' ? aspectRatioClasses[aspectRatio] : ''
                                }`}
                            />
                            {enableCaption && item.caption && (
                                <div className='absolute right-0 bottom-0 left-0 bg-gradient-to-t from-black/70 to-transparent p-4 opacity-0 transition-opacity group-hover:opacity-100'>
                                    <p className='text-sm text-white'>{item.caption}</p>
                                </div>
                            )}
                        </div>
                    ))}
                </div>

                {enableLightbox && lightboxImage && (
                    <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4' onClick={() => setLightboxImage(null)}>
                        <button className='absolute top-4 right-4 text-white hover:text-gray-300' onClick={() => setLightboxImage(null)}>
                            <svg className='h-8 w-8' fill='none' viewBox='0 0 24 24' stroke='currentColor'>
                                <path strokeLinecap='round' strokeLinejoin='round' strokeWidth={2} d='M6 18L18 6M6 6l12 12' />
                            </svg>
                        </button>
                        <img
                            src={lightboxImage.image.url}
                            alt={lightboxImage.alt || lightboxImage.caption || ''}
                            className='max-h-[90vh] max-w-full object-contain'
                            onClick={(e) => e.stopPropagation()}
                        />
                        {lightboxImage.caption && <p className='absolute right-0 bottom-4 left-0 text-center text-white'>{lightboxImage.caption}</p>}
                    </div>
                )}
            </div>
        </section>
    );
}
