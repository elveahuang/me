import React, { FC, useEffect } from 'react';
import videoJs from 'video.js';
import 'video.js/dist/video-js.css';

export type PlayerProps = {
    options?: any;
    onReady?: void;
};

export const VPlayer: FC<PlayerProps> = (props) => {
    const videoRef = React.useRef(null);
    const playerRef = React.useRef(null);
    const { options } = props;

    useEffect((): void => {
        if (!playerRef.current) {
            const videoElement = document.createElement('video-js');
            videoElement.classList.add('vjs-big-play-centered');
            videoRef.current.appendChild(videoElement);
            const player = (playerRef.current = videoJs(videoElement, options, () => {
                videoJs.log('player is ready');
            }));
        } else {
            const player = playerRef.current;
            player.autoplay(options.autoplay);
            player.src(options.sources);
        }
    }, [options, videoRef]);

    useEffect(() => {
        const player = playerRef.current;
        return () => {
            if (player && !player.isDisposed()) {
                player.dispose();
                playerRef.current = null;
            }
        };
    }, [playerRef]);

    return (
        <div>
            <div ref={videoRef} />
        </div>
    );
};

export default VPlayer;
