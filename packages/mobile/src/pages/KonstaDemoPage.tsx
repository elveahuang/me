import { Block, BlockTitle, Button, App as KonstaApp, List, ListItem, Navbar, Page, Searchbar, Toggle } from 'konsta/react';
import { useState } from 'react';

/**
 * Konsta UI 备选组件演示页。
 * 主应用组件层仍为 Ionic；此页面演示 Konsta UI（iOS 风格）作为备选，
 * 后续页面可按需切换或混用（组件 import 来源不同即可）。
 */
export function KonstaDemoPage() {
    const [dark, setDark] = useState(false);
    const [search, setSearch] = useState('');

    return (
        <KonstaApp theme='ios' dark={dark} safeAreas>
            <Page>
                <Navbar title='Konsta UI 演示' />
                <BlockTitle>开关（跟随暗色模式）</BlockTitle>
                <List strongIos outlineIos>
                    <ListItem title='暗色模式' after={<Toggle component='div' checked={dark} onChange={() => setDark(!dark)} />} />
                </List>
                <BlockTitle>搜索</BlockTitle>
                <Searchbar value={search} placeholder='搜索…' onInput={(e) => setSearch((e.target as HTMLInputElement).value)} />
                <BlockTitle>列表</BlockTitle>
                <List strongIos outlineIos>
                    <ListItem title=' Ionic 风格页面' footer='主组件层' />
                    <ListItem title='Konsta UI 页面（本页）' footer='备选组件层' />
                    <ListItem title='示例项' after='详情' />
                </List>
                <Block strongIos outlineIos>
                    <p className='mb-2'>Konsta UI 组件由 Tailwind CSS 构建，与本包的 Tailwind v4 入口共用一套工具类。</p>
                    <div className='flex gap-2'>
                        <Button outline rounded onClick={() => setSearch('')}>
                            重置搜索
                        </Button>
                        <Button rounded>主按钮</Button>
                    </div>
                </Block>
            </Page>
        </KonstaApp>
    );
}
