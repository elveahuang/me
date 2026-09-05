import { Block, BlockTitle, Button, App as KonstaApp, List, ListItem, Navbar, Page, Searchbar, Toggle } from 'konsta/react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Konsta UI 备选组件演示页。
 * 主应用组件层仍为 Ionic；此页面演示 Konsta UI（iOS 风格）作为备选，
 * 后续页面可按需切换或混用（组件 import 来源不同即可）。
 */
export function KonstaDemoPage() {
    const { t } = useTranslation();
    const [dark, setDark] = useState(false);
    const [search, setSearch] = useState('');

    return (
        <KonstaApp theme='ios' dark={dark} safeAreas>
            <Page>
                <Navbar title={t('demo.title')} />
                <BlockTitle>{t('demo.togglesTitle')}</BlockTitle>
                <List strongIos outlineIos>
                    <ListItem
                        title={t('demo.darkMode')}
                        after={<Toggle component='div' checked={dark} onChange={() => setDark(!dark)} />}
                    />
                </List>
                <BlockTitle>{t('demo.searchTitle')}</BlockTitle>
                <Searchbar value={search} placeholder={t('demo.searchPlaceholder')} onInput={(e) => setSearch((e.target as HTMLInputElement).value)} />
                <BlockTitle>{t('demo.listTitle')}</BlockTitle>
                <List strongIos outlineIos>
                    <ListItem title={t('demo.ionicItem')} footer={t('demo.ionicFooter')} />
                    <ListItem title={t('demo.konstaItem')} footer={t('demo.konstaFooter')} />
                    <ListItem title={t('demo.sampleItem')} after={t('demo.details')} />
                </List>
                <Block strongIos outlineIos>
                    <p className='mb-2'>{t('demo.tailwindNote')}</p>
                    <div className='flex gap-2'>
                        <Button outline rounded onClick={() => setSearch('')}>
                            {t('demo.resetSearch')}
                        </Button>
                        <Button rounded>{t('demo.primaryButton')}</Button>
                    </div>
                </Block>
            </Page>
        </KonstaApp>
    );
}
