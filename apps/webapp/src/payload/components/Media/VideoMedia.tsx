'use client';

import { ui } from '@/core/utils/ui.ts';
import type { Props as MediaProps } from '@/payload/components/Media/types';
import { getMediaUrl } from '@/payload/utilities/getMediaUrl.ts';
import React, { useEffect, useRef } from 'react';

export const VideoMedia: React.FC<MediaProps> = (props) => {
    const { onClick, resource, videoClassName } = props;
    const videoRef = useRef<HTMLVideoElement>(null);
    useEffect(() => {
        const { current: video } = videoRef;
        if (video) {
            video.addEventListener('suspend', () => {});
        }
    }, []);

    if (resource && typeof resource === 'object') {
        const { filename } = resource;
        return (
            <video autoPlay className={ui(videoClassName)} controls={false} loop muted onClick={onClick} playsInline ref={videoRef}>
                <source src={getMediaUrl(`/media/${filename}`)} />
            </video>
        );
    }
    return null;
};
