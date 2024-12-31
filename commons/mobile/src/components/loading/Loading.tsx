import { Loading as LoadingComponent } from 'antd-mobile';
import { FC } from 'react';
import './Loading.scss';

const Loading: FC = () => {
    return (
        <div className="loading-div-container">
            <LoadingComponent />
        </div>
    );
};

export default Loading;
