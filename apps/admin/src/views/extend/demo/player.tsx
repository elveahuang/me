import { AppPlayer } from '@commons/core/components';
import { log } from '@commons/core/utils';
import { defaultXPlayerOptions, XPlayerOptions } from '@commons/core/utils/player.ts';
import { useMount } from 'ahooks';
import { Watermark } from 'antd';
import { Draft, produce } from 'immer';
import { useState } from 'react';

const Player = () => {
    const [options, setOptions] = useState<XPlayerOptions>(defaultXPlayerOptions);

    useMount(() => {
        log(`Player.useMount...`);
        setOptions(
            produce((draft: Draft<XPlayerOptions>) => {
                draft.src = 'https://vjs.zencdn.net/v/oceans.mp4';
                draft.watermark = {
                    disable: false,
                    text: 'Hello World!',
                };
            }),
        );
    });

    return (
        <Watermark content={'elvea'} zIndex={1}>
            <div className={'m-auto mt-8'} style={{ width: 500, height: 300 }} id={'xg-player'}>
                <AppPlayer options={options} />
            </div>
        </Watermark>
    );
};

export default Player;
