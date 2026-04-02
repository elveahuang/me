'use client';

import { loginAction } from '@/core/auth/actions';
import { ActionState, defaultActionState } from '@/core/types/action';
import { Credentials } from '@/core/types/user';
import { Button, Card, FieldError, Form, Input, TextField } from '@heroui/react';
import { AppRouterInstance } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { redirect, useRouter } from 'next/navigation';
import { FormEvent, JSX, useActionState, useEffect } from 'react';
import styles from './login.module.css';

export default function LoginPage(): JSX.Element {
    const router: AppRouterInstance = useRouter();
    const [state, formAction] = useActionState<ActionState, Credentials>(loginAction, defaultActionState);

    async function doSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
        e.preventDefault();
        const formData = new FormData(e.currentTarget);
        const data: Record<string, string> = {};
        formData.forEach((value, key) => {
            data[key] = value.toString();
        });
        alert(`Form submitted with: ${JSON.stringify(data, null, 2)}`);
    }

    useEffect(() => {
        if (state.status === 'failed' || state.status === 'invalid') {
            alert('success');
        } else if (state.status === 'success') {
            router.refresh();
            redirect('/');
        }
    }, [state.status]);

    return (
        <div className={styles.pageContainer}>
            <Card className={styles.loginCard}>
                <Card.Content>
                    <Form onSubmit={doSubmit}>
                        <div className='flex max-w-md flex-col content-center gap-4'>
                            <TextField aria-label='username' name='username'>
                                <Input />
                                <FieldError />
                            </TextField>
                            <TextField aria-label='username' name='password' type='password'>
                                <Input />
                                <FieldError />
                            </TextField>
                            <div className='flex gap-2'>
                                <Button type='submit'>Submit</Button>
                                <Button type='reset' variant='secondary'>
                                    Reset
                                </Button>
                            </div>
                        </div>
                    </Form>
                </Card.Content>
            </Card>
        </div>
    );
}
