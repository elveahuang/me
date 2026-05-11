'use client';

import Link from 'next/link';

interface NavLink {
    id?: string;
    link: {
        type?: 'reference' | 'custom' | null;
        reference?: {
            relationTo: string;
            value: any;
        } | null;
        url?: string | null;
        label: string;
    };
}

interface AppNavbarProps {
    siteName?: string;
    navItems?: NavLink[] | null;
}

export function AppNavbar({ siteName = 'CMS', navItems = [] }: AppNavbarProps) {
    return (
        <header className='border-border/40 bg-background/95 supports-backdrop-filter:bg-background/60 sticky top-0 z-50 w-full border-b backdrop-blur'>
            <div className='container mx-auto flex h-16 max-w-6xl items-center justify-between px-4'>
                <div className='flex gap-6 md:gap-10'>
                    <Link href='/' className='text-xl font-bold'>
                        {siteName}
                    </Link>
                    <nav className='hidden gap-6 md:flex'>
                        {navItems?.map((item, index) => {
                            const isReference = item.link.type === 'reference';
                            let href = item.link.url || '#';

                            if (isReference && item.link.reference?.value) {
                                const refValue = item.link.reference.value;
                                const relationTo = item.link.reference.relationTo;
                                const slug = typeof refValue === 'object' && refValue.slug ? refValue.slug : refValue;
                                href = relationTo === 'pages' ? `/${slug}` : `/${relationTo}/${slug}`;
                            }

                            return (
                                <Link
                                    key={item.id || index}
                                    href={href}
                                    className='text-muted-foreground hover:text-foreground flex items-center text-sm font-medium transition-colors'
                                >
                                    {item.link.label}
                                </Link>
                            );
                        })}
                    </nav>
                </div>
                <div className='flex items-center gap-2'>
                    <Link
                        href='/posts'
                        className='bg-primary text-primary-foreground hover:bg-primary/90 inline-flex h-9 items-center justify-center rounded-md px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50'
                    >
                        阅读文章
                    </Link>
                </div>
            </div>
        </header>
    );
}
