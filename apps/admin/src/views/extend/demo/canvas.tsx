import { useMount } from 'ahooks';
import React from 'react';

const Player = () => {
    const canvasRef: React.MutableRefObject<HTMLCanvasElement> = React.useRef<HTMLCanvasElement>(null);

    useMount((): void => {
        const ctx: CanvasRenderingContext2D = canvasRef.current.getContext('2d');
        ctx.font = '24px sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = 'rgba(0, 0, 0, 0.1)';
        ctx.fillText('Hello World!', 10, 10);
    });

    return (
        <div className={'mx-auto mt-8 border-2'} style={{ width: 300, height: 300 }}>
            <canvas width={300} height={300} ref={canvasRef} />
        </div>
    );
};

export default Player;
