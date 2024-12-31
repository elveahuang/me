import { loading } from '@commons/core/constants/lottie.ts';
import { LottieOptions } from '@commons/core/utils/lottie.ts';
import { useMount } from 'ahooks';
import lottie, { AnimationItem } from 'lottie-web';
import { forwardRef, MutableRefObject, Ref, useImperativeHandle, useRef } from 'react';

export type XLottieProps = {
    options?: LottieOptions;
    onReady?: () => void;
};

export type XLottieRef = {
    play: () => void;
};

export const XLottie = forwardRef((props: XLottieProps, ref: Ref<XLottieRef>) => {
    const lottieDivRef: MutableRefObject<HTMLDivElement> = useRef<HTMLDivElement>();
    const lottieAnimationRef: MutableRefObject<AnimationItem> = useRef<AnimationItem>();
    const play = async (): Promise<void> => {
        lottieAnimationRef.current.play();
    };

    useMount(() => {
        const options = {
            container: lottieDivRef.current as Element,
            loop: false,
            autoplay: false,
            animationData: loading,
        };
        lottieAnimationRef.current = lottie.loadAnimation({ ...options, ...props.options });
        console.log({ ...options, ...props.options });
        console.log(lottieAnimationRef.current);
    });

    useImperativeHandle(ref, (): XLottieRef => {
        return {
            play: async (): Promise<void> => play(),
        };
    });

    return <div ref={lottieDivRef}></div>;
});

XLottie.displayName = 'XLottie';
export default XLottie;
