'use client';

interface Testimonial {
    quote: string;
    author: string;
    role?: string;
    company?: string;
    avatar?: {
        url: string;
        alt?: string;
    };
    rating?: number;
}

interface TestimonialsBlockProps {
    title?: string;
    testimonials: Testimonial[];
    layout?: 'grid' | 'carousel' | 'list';
    columns?: '2' | '3' | '4';
}

function StarRating({ rating = 5 }: { rating?: number }) {
    return (
        <div className='flex gap-1'>
            {[1, 2, 3, 4, 5].map((star) => (
                <svg key={star} className={`h-5 w-5 ${star <= rating ? 'text-yellow-400' : 'text-gray-300'}`} fill='currentColor' viewBox='0 0 20 20'>
                    <path d='M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z' />
                </svg>
            ))}
        </div>
    );
}

const columnClasses: Record<string, string> = {
    '2': 'md:grid-cols-2',
    '3': 'md:grid-cols-3',
    '4': 'md:grid-cols-2 lg:grid-cols-4',
};

export function TestimonialsBlock({ title, testimonials, layout = 'grid', columns = '3' }: TestimonialsBlockProps) {
    return (
        <section className='bg-gray-50 px-4 py-16 dark:bg-gray-900'>
            <div className='mx-auto max-w-6xl'>
                {title && <h2 className='mb-12 text-center text-3xl font-bold md:text-4xl'>{title}</h2>}

                <div
                    className={
                        layout === 'grid'
                            ? `grid gap-8 ${columnClasses[columns]}`
                            : layout === 'list'
                              ? 'space-y-6'
                              : 'flex snap-x snap-mandatory gap-6 overflow-x-auto pb-4'
                    }
                >
                    {testimonials.map((testimonial, index) => (
                        <div
                            key={index}
                            className={`${layout === 'carousel' ? 'w-80 flex-shrink-0 snap-start' : ''} rounded-lg bg-white p-6 shadow-lg dark:bg-gray-800`}
                        >
                            <StarRating rating={testimonial.rating} />
                            <blockquote className='mt-4 text-gray-700 italic dark:text-gray-300'>&ldquo;{testimonial.quote}&rdquo;</blockquote>
                            <div className='mt-6 flex items-center gap-4'>
                                {testimonial.avatar && (
                                    <img
                                        src={testimonial.avatar.url}
                                        alt={testimonial.avatar.alt || testimonial.author}
                                        className='h-12 w-12 rounded-full object-cover'
                                    />
                                )}
                                <div>
                                    <p className='font-semibold'>{testimonial.author}</p>
                                    {(testimonial.role || testimonial.company) && (
                                        <p className='text-sm text-gray-500 dark:text-gray-400'>
                                            {testimonial.role}
                                            {testimonial.role && testimonial.company && ' · '}
                                            {testimonial.company}
                                        </p>
                                    )}
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </section>
    );
}
