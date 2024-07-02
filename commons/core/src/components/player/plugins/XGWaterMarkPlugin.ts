import { Plugin } from 'xgplayer';
import { IPluginOptions, POSITIONS } from 'xgplayer/es/plugin/plugin';
import './XGWaterMarkPlugin.scss';

export default class XGWaterMarkPlugin extends Plugin {
    static get pluginName(): string {
        return 'XGWaterMarkPlugin';
    }

    static get defaultConfig(): { position: string } {
        return {
            position: POSITIONS.ROOT,
        };
    }

    constructor(args: IPluginOptions) {
        super(args);
    }

    render(): string {
        return `<div class="xg-player-water-mark">elvea</div>`;
    }
}
