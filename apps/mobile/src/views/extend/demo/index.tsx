import { PlatformService } from '@commons/core/services';
import { log } from '@commons/core/utils';
import { FC, useEffect } from 'react';
import { Link } from 'react-router';

const Index: FC = () => {
    useEffect((): void => {
        async function setup() {
            log(`Index.useEffect...`);
            PlatformService.initialize().then();
        }

        setup().then();
    }, []);

    return (
        <div className={'text-center'}>
            <Link to={'/demo/player'}>视频播放器</Link>
            <br />
            <Link to={'/demo/lottie'}>动效</Link>
            <br />
            <Link to={'/demo/short-video'}>短视频</Link>
            <br />
        </div>
    );
};

export default Index;
