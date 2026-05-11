import { ui } from '@/core/utils/ui.ts';
import { Media } from '@/payload/components/Media';
import RichText from '@/payload/components/RichText';
import type { MediaBlock as MediaBlockProps } from '@/payload/payload-types';
import type { StaticImageData } from 'next/image';
import React, { JSX } from 'react';

type Props = MediaBlockProps & {
    breakout?: boolean;
    captionClassName?: string;
    className?: string;
    enableGutter?: boolean;
    imgClassName?: string;
    staticImage?: StaticImageData;
    disableInnerContainer?: boolean;
};

export const MediaBlock: React.FC<Props> = (props: Props): JSX.Element => {
    const { captionClassName, className, enableGutter = true, imgClassName, media, staticImage, disableInnerContainer } = props;

    let caption;
    if (media && typeof media === 'object') caption = media.caption;

    return (
        <div
            className={ui(
                '',
                {
                    container: enableGutter,
                },
                className,
            )}
        >
            {(media || staticImage) && <Media imgClassName={ui('border border-border rounded-[0.8rem]', imgClassName)} resource={media} src={staticImage} />}
            {caption && (
                <div
                    className={ui(
                        'mt-6',
                        {
                            container: !disableInnerContainer,
                        },
                        captionClassName,
                    )}
                >
                    <RichText data={caption} enableGutter={false} />
                </div>
            )}
        </div>
    );
};
