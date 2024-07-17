import { like } from '@commons/core/constants/pags';
import { usePag } from '@commons/core/hooks/usePag';
import { log } from '@commons/core/utils';
import { useMount } from 'ahooks';
import { PAGFile } from 'libpag/types/pag-file';
import { PAGView } from 'libpag/types/pag-view';
import { useRef } from 'react';

const Pag = () => {
    const { pag } = usePag();
    const canvasRef1 = useRef(null);
    const canvasRef2 = useRef(null);

    useMount(async (): Promise<void> => {
        log(`Page Pag mount. ${like}`);
        fetch(like).then(async (response: Response): Promise<void> => {
            const file: PAGFile = await pag.PAGFile.load(await response.blob());
            const pagView1: PAGView = await pag.PAGView.init(file, canvasRef1.current);
            pagView1.setRepeatCount(1);
            await pagView1.play();
        });
        fetch(like).then(async (response: Response): Promise<void> => {
            const file: PAGFile = await pag.PAGFile.load(await response.blob());
            const pagView2: PAGView = await pag.PAGView.init(file, canvasRef2.current);
            pagView2.setRepeatCount(0);
            await pagView2.play();
        });
    });

    return (
        <div className={'text-center'}>
            <canvas className={'mx-auto'} ref={canvasRef1}></canvas>
            <canvas className={'mx-auto'} ref={canvasRef2}></canvas>
        </div>
    );
};

export default Pag;
