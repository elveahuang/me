import JrAlert from './JrAlert.vue';
import JrBadge from './JrBadge.vue';
import JrCard from './JrCard.vue';
import JrStat from './JrStat.vue';

/**
 * json-render 组件目录（webapp 的 server/utils/catalog.ts）在移动端的 Vue 实现。
 * 与 webapp 的 app/utils/json-ui.ts 保持同名映射，两端渲染结果一致。
 */
export const uiComponents = {
    Card: JrCard,
    Stat: JrStat,
    Badge: JrBadge,
    Alert: JrAlert,
};
