import JrAlert from '~/components/json-ui/JrAlert.vue';
import JrBadge from '~/components/json-ui/JrBadge.vue';
import JrCard from '~/components/json-ui/JrCard.vue';
import JrStat from '~/components/json-ui/JrStat.vue';

/**
 * json-render 组件目录（server/utils/catalog.ts）对应的 Vue 实现。
 *
 * 生成式 UI 采用「提示词驱动」方案：模型在 Markdown 回复里插入 ```json-render 代码块，
 * 由 Comark 的 json-render 插件（见 ChatMessage.vue）解析后，按下表映射成组件渲染。
 * 组件名必须与 catalog 中的定义一一对应。
 */
export const uiComponents = {
    Card: JrCard,
    Stat: JrStat,
    Badge: JrBadge,
    Alert: JrAlert,
};
