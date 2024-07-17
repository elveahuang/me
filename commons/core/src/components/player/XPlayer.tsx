import { log } from '@commons/core/utils';
import { getXPlayerOptions, XPlayerOptions, XPlayerPreset } from '@commons/core/utils/player.ts';
import { isFunction, merge } from 'lodash-es';
import React, { FC, useEffect } from 'react';
import Player, { SimplePlayer } from 'xgplayer';
import './XPlayer.scss';

export type XPlayerProps = {
    mode?: string;
    options?: XPlayerOptions;
    onReady?: void;
};

const setupPlayer = async (): Promise<void> => {
    log('XPlayer setup...');
    SimplePlayer.defaultPreset = XPlayerPreset;
};

export const XPlayer: FC<XPlayerProps> = (props: XPlayerProps) => {
    const videoRef = React.useRef(null);
    const playerRef = React.useRef(null);
    const { options } = props;

    useEffect((): void => {
        if (!playerRef.current) {
            setupPlayer().then();
            const playerOptions: XPlayerOptions = merge(
                {
                    el: videoRef.current,
                    url: props.options.src,
                },
                options,
            );
            const player: Player = new Player(getXPlayerOptions(playerOptions));
            if (isFunction(props.onReady)) {
                props.onReady();
            }
        } else {
            const player = playerRef.current;
            player.autoplay(options.autoplay);
            player.src(options.sources);
        }
    }, [options, videoRef]);

    useEffect(() => {
        const player = playerRef.current;
        return (): void => {
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

export default XPlayer;
