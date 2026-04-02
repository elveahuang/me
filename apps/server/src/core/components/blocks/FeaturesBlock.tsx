'use client';

import React from 'react';

interface Feature {
    icon?: string;
    title: string;
    description?: string;
}

interface FeaturesBlockProps {
    title?: string;
    subtitle?: string;
    features: Feature[];
    columns?: '2' | '3' | '4';
    style?: 'cards' | 'minimal' | 'centered';
}

const iconComponents: Record<string, React.ReactNode> = {
    lightning: (
        <svg className='h-8 w-8' fill='none' viewBox='0 0 24 24' stroke='currentColor'>
            <path strokeLinecap='round' strokeLinejoin='round' strokeWidth={2} d='M13 10V3L4 14h7v7l9-11h-7z' />
        </svg>
    ),
    shield: (
        <svg className='h-8 w-8' fill='none' viewBox='0 0 24 24' stroke='currentColor'>
            <path
                strokeLinecap='round'
                strokeLinejoin='round'
                strokeWidth={2}
                d='M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z'
            />
        </svg>
    ),
    cog: (
        <svg className='h-8 w-8' fill='none' viewBox='0 0 24 24' stroke='currentColor'>
            <path
                strokeLinecap='round'
                strokeLinejoin='round'
                strokeWidth={2}
                d='M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z'
            />
            <path strokeLinecap='round' strokeLinejoin='round' strokeWidth={2} d='M15 12a3 3 0 11-6 0 3 3 0 016 0z' />
        </svg>
    ),
    star: (
        <svg className='h-8 w-8' fill='none' viewBox='0 0 24 24' stroke='currentColor'>
            <path
                strokeLinecap='round'
                strokeLinejoin='round'
                strokeWidth={2}
                d='M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z'
            />
        </svg>
    ),
    heart: (
        <svg className='h-8 w-8' fill='none' viewBox='0 0 24 24' stroke='currentColor'>
            <path
                strokeLinecap='round'
                strokeLinejoin='round'
                strokeWidth={2}
                d='M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z'
            />
        </svg>
    ),
    bulb: (
        <svg className='h-8 w-8' fill='none' viewBox='0 0 24 24' stroke='currentColor'>
            <path
                strokeLinecap='round'
                strokeLinejoin='round'
                strokeWidth={2}
                d='M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z'
            />
        </svg>
    ),
    rocket: (
        <svg className='h-8 w-8' fill='none' viewBox='0 0 24 24' stroke='currentColor'>
            <path
                strokeLinecap='round'
                strokeLinejoin='round'
                strokeWidth={2}
                d='M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z'
            />
        </svg>
    ),
    chart: (
        <svg className='h-8 w-8' fill='none' viewBox='0 0 24 24' stroke='currentColor'>
            <path
                strokeLinecap='round'
                strokeLinejoin='round'
                strokeWidth={2}
                d='M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z'
            />
        </svg>
    ),
    lock: (
        <svg className='h-8 w-8' fill='none' viewBox='0 0 24 24' stroke='currentColor'>
            <path
                strokeLinecap='round'
                strokeLinejoin='round'
                strokeWidth={2}
                d='M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z'
            />
        </svg>
    ),
    cloud: (
        <svg className='h-8 w-8' fill='none' viewBox='0 0 24 24' stroke='currentColor'>
            <path
                strokeLinecap='round'
                strokeLinejoin='round'
                strokeWidth={2}
                d='M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z'
            />
        </svg>
    ),
};

const columnClasses: Record<string, string> = {
    '2': 'md:grid-cols-2',
    '3': 'md:grid-cols-3',
    '4': 'md:grid-cols-2 lg:grid-cols-4',
};

export function FeaturesBlock({ title, subtitle, features, columns = '3', style = 'cards' }: FeaturesBlockProps) {
    return (
        <section className='px-4 py-16'>
            <div className='mx-auto max-w-6xl'>
                {(title || subtitle) && (
                    <div className='mb-12 text-center'>
                        {title && <h2 className='mb-4 text-3xl font-bold md:text-4xl'>{title}</h2>}
                        {subtitle && <p className='text-lg text-gray-600 dark:text-gray-400'>{subtitle}</p>}
                    </div>
                )}

                <div className={`grid gap-8 ${columnClasses[columns]}`}>
                    {features.map((feature, index) => (
                        <div
                            key={index}
                            className={`${
                                style === 'cards' ? 'rounded-lg bg-white p-6 shadow-lg dark:bg-gray-800' : style === 'centered' ? 'text-center' : ''
                            }`}
                        >
                            {feature.icon && iconComponents[feature.icon] && (
                                <div className={`mb-4 ${style === 'centered' ? 'flex justify-center' : ''} text-blue-600`}>{iconComponents[feature.icon]}</div>
                            )}
                            <h3 className='mb-2 text-xl font-semibold'>{feature.title}</h3>
                            {feature.description && <p className='text-gray-600 dark:text-gray-400'>{feature.description}</p>}
                        </div>
                    ))}
                </div>
            </div>
        </section>
    );
}
