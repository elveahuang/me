import { DotLottieOptions } from '@commons/core/utils/lottie';
import { DotLottie } from '@lottiefiles/dotlottie-web';
import { useMount } from 'ahooks';
import { forwardRef, MutableRefObject, Ref, useImperativeHandle, useRef } from 'react';

export type XDotLottieProps = {
    options?: DotLottieOptions;
    onReady?: () => void;
};

export type XDotLottieRef = {
    play: () => void;
};

export const XDotLottie = forwardRef((props: XDotLottieProps, ref: Ref<XDotLottieRef>) => {
    const dotLottieCanvasRef: MutableRefObject<HTMLCanvasElement> = useRef<HTMLCanvasElement>();
    const dotLottieRef: MutableRefObject<DotLottie> = useRef<DotLottie>();
    const play = async (): Promise<void> => {
        dotLottieRef.current.play();
    };

    useMount(() => {
        const options: DotLottieOptions = {
            canvas: dotLottieCanvasRef.current,
            loop: false,
            autoplay: false,
        };
        dotLottieRef.current = new DotLottie({ ...options, ...props.options });
        console.log({ ...options, ...props.options });
        console.log(dotLottieRef.current);
    });

    useImperativeHandle(ref, (): XDotLottieRef => {
        return {
            play: async (): Promise<void> => play(),
        };
    });

    return <canvas width={100} height={100} ref={dotLottieCanvasRef}></canvas>;
});

XDotLottie.displayName = 'XDotLottie';
export default XDotLottie;
