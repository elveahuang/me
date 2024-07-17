import { AppVPlayer } from '@commons/core/components';
import { PlatformService } from '@commons/core/services';
import { log } from '@commons/core/utils';
import { FC, useEffect } from 'react';

const Index: FC = () => {
    useEffect(() => {
        log(`Index.useEffect...`);
        PlatformService.initialize().then();
    }, []);
    return (
        <div>
            <AppVPlayer></AppVPlayer>
        </div>
    );
};

export default Index;
