import { isEmpty } from 'radash';
import { Events, IPluginOptions, Plugin } from 'xgplayer';
import { POSITIONS } from 'xgplayer/es/plugin/plugin';

export default class XGWaterMarkPlugin extends Plugin {
    static get pluginName(): string {
        return 'watermark';
    }

    static get defaultConfig(): { position: string; disable: boolean; text: string; rotate: number; zIndex: number } {
        return {
            position: POSITIONS.ROOT,
            disable: true,
            text: '',
            rotate: 30,
            zIndex: 9999,
        };
    }

    constructor(args: IPluginOptions) {
        super(args);
    }

    afterCreate(): void {
        super.afterCreate();

        if (this.config.disable) {
            return;
        }

        this.renderWatermark();
        this.on(Events.FULLSCREEN_CHANGE, (isFullscreen: boolean): void => {
            console.log(`Events.FULLSCREEN_CHANGE ${isFullscreen}`);
            if (isFullscreen) {
                this.root.style.display = 'block';
            } else {
                this.root.style.display = 'none';
            }
        });
        this.on(Events.CSS_FULLSCREEN_CHANGE, (isCssFullScreen: boolean): void => {
            console.log(`Events.CSS_FULLSCREEN_CHANGE ${isCssFullScreen}`);
            if (isCssFullScreen) {
                this.root.style.display = 'block';
            } else {
                this.root.style.display = 'none';
            }
        });
    }

    renderWatermark(): void {
        const canvas: HTMLCanvasElement = document.createElement('canvas');
        const ctx: CanvasRenderingContext2D = canvas.getContext('2d');
        const metrics: TextMetrics = ctx.measureText(this.config.text);
        const width = this.config.width ?? Math.ceil(metrics.width * 2);

        canvas.style.display = 'none';
        canvas.width = Math.ceil(width);
        canvas.height = Math.ceil(width);

        ctx.font = '16px sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = 'rgba(0, 0, 0, 0.1)';
        ctx.rotate((-30 * Math.PI) / 180);
        ctx.fillText(this.config.text, 0, Math.ceil(width / 2));

        const data: string = canvas.toDataURL('image/png');
        this.root.style.backgroundImage = 'url(' + data + ')';
        this.root.style.backgroundSize = `${width}px`;
        this.root.style.backgroundRepeat = 'repeat';
        this.root.style.backgroundPositionX = '0';
        this.root.style.backgroundPositionY = '0';
        this.root.style.userSelect = 'none';
        this.root.style.pointerEvents = 'none';
        this.root.style.position = 'absolute';
        this.root.style.top = '0';
        this.root.style.left = '0';
        this.root.style.zIndex = this.config.zIndex;
        this.root.style.width = '100%';
        this.root.style.height = '100%';
        this.root.style.display = 'none';
    }

    render(): string | HTMLElement {
        if (this.config.disable || isEmpty(this.config.text)) {
            return;
        }
        return `<div class="xg-player-watermark"></div>`;
    }
}

export type XGWaterMarkConfig = {
    [propName: string]: any;
    disable?: boolean;
    text?: string;
    zIndex?: number;
    rotate?: number;
    width?: number;
    height?: number;
};
