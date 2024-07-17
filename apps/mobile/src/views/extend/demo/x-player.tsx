import { AppXPlayer } from '@commons/core/components';
import { PlatformService } from '@commons/core/services';
import { log } from '@commons/core/utils';
import { XPlayerOptions } from '@commons/core/utils/player.ts';
import { FC, useEffect, useState } from 'react';

const Index: FC = () => {
    const [options, setOptions] = useState<XPlayerOptions>({});

    useEffect(() => {
        log(`Index.useEffect...`);
        PlatformService.initialize().then();
        setOptions({
            src: 'https://vjs.zencdn.net/v/oceans.mp4',
        });
    }, []);

    return (
        <div className="container mx-auto mt-6 text-center">
            <AppXPlayer options={options}></AppXPlayer>
        </div>
    );
};

export default Index;
