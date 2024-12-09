import { log } from '@commons/core/utils';
import { useEffect } from 'react';
import { Link } from 'react-router';

const Index = () => {
    useEffect((): void => {
        log(`Index.useEffect...`);
    }, []);

    return (
        <div className={'text-center'}>
            <Link to={'/profile'}>Profile</Link>
            <br />
            <Link to={'/player'}>Player</Link>
        </div>
    );
};

export default Index;
