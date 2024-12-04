import { NavBar } from 'antd-mobile';
import { FC } from 'react';
import { Link } from 'react-router';

const Discover: FC = () => {
    return (
        <div>
            <NavBar back={null}>标题</NavBar>

            <Link to={'/about'}>Discover</Link>
        </div>
    );
};

export default Discover;
