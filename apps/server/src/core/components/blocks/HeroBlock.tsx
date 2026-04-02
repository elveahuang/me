interface HeroBlockProps {
    title: string;
    subtitle?: string;
    description?: string;
    media?: {
        url: string;
        alt?: string;
    };
    actions?: Array<{
        link: {
            url: string;
            label?: string;
            newTab?: boolean;
            appearance?: 'default' | 'outline';
        };
    }>;
    enableBackgroundOverlay?: boolean;
    overlayOpacity?: number;
    type?: 'highImpact' | 'mediumImpact' | 'lowImpact';
}

export function HeroBlock({
    title,
    subtitle,
    description,
    media,
    actions,
    enableBackgroundOverlay = true,
    overlayOpacity = 50,
    type = 'highImpact',
}: HeroBlockProps) {
    const impactStyles = {
        highImpact: 'min-h-[80vh] text-white',
        mediumImpact: 'min-h-[60vh] text-white',
        lowImpact: 'min-h-[40vh]',
    };

    return (
        <section
            className={`relative flex items-center justify-center ${impactStyles[type]}`}
            style={{
                backgroundColor: media ? undefined : 'var(--color-primary)',
            }}
        >
            {media && (
                <>
                    <img src={media.url} alt={media.alt || title} className='absolute inset-0 h-full w-full object-cover' />
                    {enableBackgroundOverlay && <div className='absolute inset-0 bg-black' style={{ opacity: overlayOpacity / 100 }} />}
                </>
            )}

            <div className='relative z-10 mx-auto max-w-4xl px-4 text-center'>
                {subtitle && <p className='mb-4 text-lg opacity-90'>{subtitle}</p>}
                <h1 className='mb-6 text-4xl font-bold md:text-5xl lg:text-6xl'>{title}</h1>
                {description && <p className='mx-auto mb-8 max-w-2xl text-xl opacity-90'>{description}</p>}
                {actions && actions.length > 0 && (
                    <div className='flex flex-wrap justify-center gap-4'>
                        {actions.map((action, index) => (
                            <a
                                key={index}
                                href={action.link.url}
                                target={action.link.newTab ? '_blank' : undefined}
                                rel={action.link.newTab ? 'noopener noreferrer' : undefined}
                                className={`rounded-lg px-8 py-3 font-medium transition-colors ${
                                    action.link.appearance === 'outline'
                                        ? 'border-2 border-white hover:bg-white hover:text-black'
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
