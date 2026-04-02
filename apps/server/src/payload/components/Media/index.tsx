import { ImageMedia } from '@/payload/components/Media/ImageMedia';
import type { Props } from '@/payload/components/Media/types';
import { VideoMedia } from '@/payload/components/Media/VideoMedia';
import React, { Fragment } from 'react';

export const Media: React.FC<Props> = (props) => {
    const { className, htmlElement = 'div', resource } = props;

    const isVideo = typeof resource === 'object' && resource?.mimeType?.includes('video');
    const Tag = htmlElement || Fragment;

    return (
        <Tag
            {...(htmlElement !== null
                ? {
                      className,
                  }
                : {})}
        >
            {isVideo ? <VideoMedia {...props} /> : <ImageMedia {...props} />}
        </Tag>
    );
};
