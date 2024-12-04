import { PlatformService } from '@commons/core/services';
import { log } from '@commons/core/utils';
import { useEffect } from 'react';

const Profile = () => {
    useEffect(() => {
        log(`Index.useEffect...`);
        PlatformService.initialize().then();
    }, []);
    return <div>Profile</div>;
};

export default Profile;
