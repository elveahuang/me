import { NavBar } from 'antd-mobile';
import { FC } from 'react';
import { Link } from 'react-router-dom';

const Home: FC = () => {
    return (
        <div className={'text-center'}>
            <NavBar back={null}>标题</NavBar>
            <br />
            <Link to={'/demo'}>Demo</Link>
            <br />
            <Link to={'/about'}>About</Link>
        </div>
    );
};

export default Home;
