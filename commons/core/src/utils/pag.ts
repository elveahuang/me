import { env } from '@commons/core/env';
import { log } from '@commons/core/utils';
import { PAGInit } from 'libpag';
import { PAG } from 'libpag/types/types';

export let pag: PAG;

export const setupPag = async (): Promise<void> => {
    const path: string = env.base + 'wasm/libpag.wasm';
    log(`Pag [${path}] initialize...`);
    pag = await PAGInit({ locateFile: (file): string => path });
};
