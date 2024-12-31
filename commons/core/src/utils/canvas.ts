const prepareCanvas = (
    width: number,
    height: number,
    ratio: number = 1,
): [ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, realWidth: number, realHeight: number] => {
    const canvas: HTMLCanvasElement = document.createElement('canvas');
    const ctx: CanvasRenderingContext2D = canvas.getContext('2d')!;

    const realWidth: number = width * ratio;
    const realHeight: number = height * ratio;
    canvas.setAttribute('width', `${realWidth}px`);
    canvas.setAttribute('height', `${realHeight}px`);
    ctx.save();

    return [ctx, canvas, realWidth, realHeight];
};
