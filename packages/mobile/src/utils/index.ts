import { setupI18n } from '@commons/i18n';
import { setupIonicReact } from '@ionic/react';

export async function setup(): Promise<void> {
    // 国际化
    await setupI18n();
    //
    setupIonicReact();
}
