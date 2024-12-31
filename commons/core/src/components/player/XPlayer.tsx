import { log } from '@commons/core/utils';
import { defaultXPlayerOptions, XPlayerOptions, XPlayerPreset } from '@commons/core/utils/player.ts';
import { isFunction } from 'radash';
import React, { FC, useEffect } from 'react';
import Player, { SimplePlayer } from 'xgplayer';
import './XPlayer.scss';

export type XPlayerProps = {
    mode?: string;
    options?: XPlayerOptions;
    onReady?: (player: Player) => void;
};

const setupPlayer = async (): Promise<void> => {
    log('XPlayer setup...');
    SimplePlayer.defaultPreset = XPlayerPreset;
};

export const XPlayer: FC<XPlayerProps> = (props: XPlayerProps) => {
    const wrapperRef = React.useRef<HTMLDivElement>(null);
    const playerRef = React.useRef<Player>();
    const { options } = props;

    useEffect((): void => {
        if (!playerRef.current) {
            setupPlayer().then();
            const playerOptions: XPlayerOptions = {
                ...defaultXPlayerOptions,
                ...{
                    el: wrapperRef.current,
                    url: props.options.src,
                },
                ...options,
            };
            const player: Player = (playerRef.current = new Player(playerOptions));
            if (isFunction(props.onReady)) {
                props.onReady(player);
            }
        } else {
            const player = playerRef.current;
            player.switchURL(options.src).then();
        }
    }, [options, wrapperRef]);

    return <div className={'app-player'} ref={wrapperRef} />;
};
XPlayer.displayName = 'XPlayer';
export default XPlayer;
