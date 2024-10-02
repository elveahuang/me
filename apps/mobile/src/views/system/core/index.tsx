import { PlatformService } from '@commons/core/services';
import { log } from '@commons/core/utils';
import { Button } from 'antd-mobile';
import { FC, useEffect } from 'react';
import { Link } from 'react-router-dom';

const Index: FC = () => {
    useEffect(() => {
        log(`Index.useEffect...`);
        PlatformService.initialize().then();
    }, []);
    return (
        <>
            <Link to={'/about'}>About</Link>
            <br />
            <Link to={'/wecom'}>WeCom</Link>
            <br />
            <Link to={'/profile'}>profile</Link>
            <br />
            <Link to={'/demo'}>Demo</Link>
            <br />
            <Button>A</Button>
        </>
    );
};

export default Index;
