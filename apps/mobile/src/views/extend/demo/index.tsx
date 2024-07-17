import { PlatformService } from '@commons/core/services';
import { log } from '@commons/core/utils';
import { FC, useEffect } from 'react';
import { Link } from 'react-router-dom';

const Index: FC = () => {
    useEffect((): void => {
        async function setup() {
            log(`Index.useEffect...`);
            PlatformService.initialize().then();
        }

        setup().then();
    }, []);

    return (
        <>
            <Link to={'/demo/x-player'}>视频播放器</Link>
            <br />
            <Link to={'/demo/v-player'}>视频播放器</Link>
            <br />
            <Link to={'/demo/short-video'}>短视频</Link>
            <br />
            <Link to={'/demo/pag'}>动效果</Link>
            <br />
        </>
    );
};

export default Index;
