import { AppPlayer } from '@commons/core/components';
import { XPlayerOptions } from '@commons/core/utils/player.ts';
import { Watermark } from 'antd';

const Player = () => {
    const options: XPlayerOptions = {
        src: 'https://vjs.zencdn.net/v/oceans.mp4',
        watermark: {
            disable: false,
            text: 'Hello World!',
        },
    };

    return (
        <Watermark content={'elvea'} zIndex={1}>
            <div className={'m-auto mt-8'} style={{ width: 500, height: 300 }} id={'xg-player'}>
                <AppPlayer options={options} />
            </div>
        </Watermark>
    );
};

export default Player;
