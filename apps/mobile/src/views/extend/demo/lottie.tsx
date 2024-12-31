import { AppDotLottie, AppLottie } from '@commons/core/components';
import { XDotLottieRef } from '@commons/core/components/lottie/XDotLottie.tsx';
import { XLottieRef } from '@commons/core/components/lottie/XLottie.tsx';
import { loading as dotLottieLoading } from '@commons/core/constants/dot-lottie.ts';
import { loading as lottieLoading } from '@commons/core/constants/lottie.ts';
import { log } from '@commons/core/utils';
import { DotLottieOptions, LottieOptions } from '@commons/core/utils/lottie.ts';
import { Button } from 'antd';
import { FC, MutableRefObject, useEffect, useRef } from 'react';

const Lottie: FC = () => {
    const lottieRef: MutableRefObject<XLottieRef> = useRef<XLottieRef>();
    const dotLottieRef: MutableRefObject<XDotLottieRef> = useRef<XDotLottieRef>();

    const lottieOptions = {
        animationData: lottieLoading,
    } as LottieOptions;

    const dotLottieOptions = {
        src: dotLottieLoading,
    } as DotLottieOptions;

    const playLottie = () => {
        lottieRef.current.play();
    };

    const playDotLottie = () => {
        dotLottieRef.current.play();
    };

    useEffect(() => {
        log(`Index.useEffect...`);
    }, []);

    return (
        <div className="container mx-auto mt-6 text-center">
            <Button onClick={playLottie}></Button>
            <AppLottie ref={lottieRef} options={lottieOptions}></AppLottie>
            <Button onClick={playDotLottie}></Button>
            <AppDotLottie ref={dotLottieRef} options={dotLottieOptions}></AppDotLottie>
        </div>
    );
};

export default Lottie;
