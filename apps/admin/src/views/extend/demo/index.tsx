import { Link } from 'react-router';
import './index.scss';

const Demo = () => {
    return (
        <div>
            <Link to={'/demo/player'}>视频播放器</Link>
            <br />
            <a href={'/demo/player'}>
                <span>Player</span>
            </a>
            <br />
            <a href={'/demo/canvas'}>
                <span>Canvas</span>
            </a>{' '}
            <br />
            <a href={'/demo/pag'}>
                <span>Pag</span>
            </a>
        </div>
    );
};

export default Demo;
