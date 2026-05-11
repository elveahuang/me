'use client';

import RichText from '@/payload/components/RichText';

interface CTABlockProps {
    title: string;
    description?: any;
    actions?: Array<{
        link: {
            url: string;
            label?: string;
            newTab?: boolean;
            appearance?: 'default' | 'outline';
        };
    }>;
    backgroundColor?: 'primary' | 'secondary' | 'accent' | 'light' | 'dark';
    alignment?: 'left' | 'center' | 'right';
}

const bgColors: Record<string, string> = {
    primary: 'bg-blue-600 text-white',
    secondary: 'bg-gray-600 text-white',
    accent: 'bg-green-600 text-white',
    light: 'bg-gray-100 text-gray-900',
    dark: 'bg-gray-900 text-white',
};

const alignments: Record<string, string> = {
    left: 'text-left',
    center: 'text-center',
    right: 'text-right',
};

export function CTABlock({ title, description, actions, backgroundColor = 'primary', alignment = 'center' }: CTABlockProps) {
    return (
        <section className={`px-4 py-16 ${bgColors[backgroundColor]}`}>
            <div className={`mx-auto max-w-4xl ${alignments[alignment]}`}>
                <h2 className='mb-4 text-3xl font-bold md:text-4xl'>{title}</h2>
                {description && (
                    <div className='mb-8 text-lg opacity-90'>
                        <RichText data={description} />
                    </div>
                )}
                {actions && actions.length > 0 && (
                    <div
                        className={`flex flex-wrap gap-4 ${alignment === 'center' ? 'justify-center' : alignment === 'right' ? 'justify-end' : 'justify-start'}`}
                    >
                        {actions.map((action, index) => (
                            <a
                                key={index}
                                href={action.link.url}
                                target={action.link.newTab ? '_blank' : undefined}
                                rel={action.link.newTab ? 'noopener noreferrer' : undefined}
                                className={`rounded-lg px-8 py-3 font-medium transition-colors ${
                                    action.link.appearance === 'outline'
                                        ? 'border-2 border-current hover:bg-white hover:text-black'
                                        : backgroundColor === 'light'
                                          ? 'bg-blue-600 text-white hover:bg-blue-700'
                                          : 'bg-white text-black hover:bg-gray-100'
                                }`}
                            >
                                {action.link.label || '了解更多'}
                            </a>
                        ))}
                    </div>
                )}
            </div>
        </section>
    );
}
