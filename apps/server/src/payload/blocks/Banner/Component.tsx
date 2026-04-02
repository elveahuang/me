import { ui } from '@/core/utils/ui';
import RichText from '@/payload/components/RichText';
import type { BannerBlock as BannerBlockProps } from '@/payload/payload-types';
import React, { JSX } from 'react';

type Props = {
    className?: string;
} & BannerBlockProps;

export const BannerBlock: React.FC<Props> = ({ className, content, style }: Props): JSX.Element => {
    return (
        <div className={ui('mx-auto my-8 w-full', className)}>
            <div
                className={ui('flex items-center rounded border px-6 py-3', {
                    'border-border bg-card': style === 'info',
                    'border-error bg-error/30': style === 'error',
                    'border-success bg-success/30': style === 'success',
                    'border-warning bg-warning/30': style === 'warning',
                })}
            >
                <RichText data={content} enableGutter={false} enableProse={false} />
            </div>
        </div>
    );
};
