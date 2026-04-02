import clsx from 'clsx';
import React, { JSX } from 'react';

interface Props {
    className?: string;
    loading?: 'lazy' | 'eager';
    priority?: 'auto' | 'high' | 'low';
}

export const Logo: React.FC<Props> = (props: Props): JSX.Element => {
    const { loading: loadingFromProps, priority: priorityFromProps, className } = props;
    const loading = loadingFromProps || 'lazy';
    const priority = priorityFromProps || 'low';
    return (
        <img
            alt='Payload Logo'
            width={193}
            height={34}
            loading={loading}
            fetchPriority={priority}
            decoding='async'
            className={clsx('w-full', className)}
            src='https://raw.githubusercontent.com/payloadcms/payload/main/packages/ui/src/assets/payload-logo-light.svg'
        />
    );
};
