import { NavBar } from 'antd-mobile';
import { FC } from 'react';
import { Link } from 'react-router-dom';

const Me: FC = () => {
    return (
        <div>
            <NavBar back={null}>标题</NavBar>

            <Link to={'/about'}>Me</Link>
        </div>
    );
};

export default Me;
