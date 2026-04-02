'use client';

import { Highlight, themes } from 'prism-react-renderer';
import React, { JSX } from 'react';

type Props = {
    code: string;
    language?: string;
};

export const Code: React.FC<Props> = ({ code, language = '' }: Props): JSX.Element => {
    return (
        <Highlight code={code} language={language} theme={themes.vsDark}>
            {({ getLineProps, getTokenProps, tokens }) => (
                <pre className='border-border overflow-x-auto rounded border bg-black p-4 text-xs'>
                    {tokens.map((line, i) => (
                        <div key={i} {...getLineProps({ className: 'table-row', line })}>
                            <span className='table-cell text-right text-white/25 select-none'>{i + 1}</span>
                            <span className='table-cell pl-4'>
                                {line.map((token, key) => (
                                    <span key={key} {...getTokenProps({ token })} />
                                ))}
                            </span>
                        </div>
                    ))}
                </pre>
            )}
        </Highlight>
    );
};
