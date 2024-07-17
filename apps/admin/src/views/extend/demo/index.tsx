import { useMount } from 'ahooks';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import './index.scss';

const Demo = () => {
    const [show, setShow] = useState(false);

    useMount((): void => {
        setInterval(() => {
            setShow(true);
        }, 5000);
    });
    return (
        <div>
            <Link to={'/demo/player'}>视频播放器</Link>
            <br />
            {show ? '1' : '0'}
            <br />
            <a href={'/demo/player'}>
                <span>Player</span>
            </a>{' '}
            <br />
            <a href={'/demo/canvas'}>
                <span>Canvas</span>
            </a>
        </div>
    );
};

export default Demo;
