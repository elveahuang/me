'use server';

import { LoginApiParams } from '@/core/api/auth';
import { FormEvent, SVGProps } from 'react';

export type IconSvgProps = SVGProps<SVGSVGElement> & {
    size?: number;
};

export type FormSubmitHandler = (e: FormEvent<HTMLFormElement>) => Promise<void> | void;

export type LoginActionType = (params: LoginApiParams) => Promise<void>;
