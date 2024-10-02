import { NavBar } from 'antd-mobile';
import { FC } from 'react';
import { Link } from 'react-router-dom';

const Home: FC = () => {
    return (
        <div>
            <NavBar>About</NavBar>

            <Link to={'/about'}>About</Link>
        </div>
    );
};

export default Home;
