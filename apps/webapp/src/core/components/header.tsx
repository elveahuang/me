'use client';

import { logoutAction } from '@/app/(auth)/actions';
import { Logo } from '@/core/components/icons';
import { ThemeSwitch } from '@/core/components/theme-switch';
import { ActionState, defaultActionState } from '@/core/types/action';
import { Credentials } from '@/core/types/user';
import { Button } from '@heroui/react';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { JSX, startTransition, useActionState, useEffect } from 'react';

export function Header(): JSX.Element {
    const { data } = useSession();
    const [state, logout] = useActionState<ActionState, Credentials>(logoutAction, defaultActionState);
    const logoutHandler = (): void => {
        startTransition((): void => {
            logout({});
        });
    };

    useEffect(() => {
        if (state.status === 'success') {
            redirect('/');
        }
    }, [state.status]);

    return (
        <div>
            <div>
                <div>
                    <Logo />
                    <p className='font-bold text-inherit'>ME</p>
                </div>
            </div>
            <div>
                <Link href='/'>Home</Link>
                <Link href='/contact'>Contact</Link>
                <Link href='/about'>About</Link>
            </div>
            <div>
                <p>Welcome {data?.user?.username}</p>
                <p>Welcome {data?.user?.id}</p>
                <div className='hidden lg:flex'>
                    <Link href='/login'>Login</Link>
                </div>
                <div>
                    <Button>Sign Up</Button> <Button onPress={logoutHandler}>Sign out</Button>
                </div>
                <ThemeSwitch />
                <div />
            </div>
        </div>
    );
}
