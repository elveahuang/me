import { Button } from '@heroui/react';
import { useTranslation } from 'react-i18next';

const Home = () => {
    const { t } = useTranslation();
    return (
        <div className={'container text-center'}>
            <div> {t('about', { ns: 'common' })}</div>
            <Button color='primary'>Button</Button>
            <div className='flex items-center gap-4'>
                <Button size='sm'>Small</Button>
                <Button size='md'>Medium</Button>
                <Button size='lg'>Large</Button>
            </div>
            <div className='p-8 text-center'>A</div>
        </div>
    );
};

export default Home;
