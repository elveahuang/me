import { sql } from 'drizzle-orm';
import { db } from './db';

/**
 * 「同一类资源里最多只有一行 isDefault」这条不变量的串行化闸门。
 *
 * 四个写入点都是同一个形状：`update … set is_default = false where is_default = true` 紧跟着
 * 把自己的行设为默认。放在一个事务里只保证了原子提交，**没保证互斥**——
 * 在 READ COMMITTED 下，两个并发事务各自看不到对方尚未提交的默认行：
 * - 表里本来没有默认行时，两边「清掉其它默认」都影响 0 行，然后各插/各改成默认 → 两个默认；
 * - 表里本来有默认行时，第二条 UPDATE 会在行锁上排队，前一个提交后它按新快照重算 WHERE，
 *   于是这种情形反而是安全的。
 * 也就是说：这条不变量只在「恰好已有默认行」时成立，而「还没有默认」正是首次配置与
 * 并发新建的常态。而两个默认供应商/两个默认存储配置会让下游各挑各的那一行
 * （`resolveModel` 与附件写入都按 `isDefault` 取第一行），表现是「同样的请求时好时坏」，
 * 管理端界面看不出任何异常。
 *
 * 库里没有条件唯一索引可用（`where is_default` 的部分索引需要一次迁移，属另行授权），
 * 所以用事务级 advisory 锁把「清 + 写」串到一把锁上；每个资源一把独立锁键，
 * 互不排队。锁键必须是返回 bigint 的 `hashtextextended`——`hashtext()` 返回 integer，
 * 而尾上的 `::bigint` cast 作用在函数的 void 返回值上会让整条语句报错。
 */
const DEFAULT_SLOT_LOCKS = {
    providers: 'default-slot:providers',
    storage: 'default-slot:storage',
} as const;

export type DefaultSlotResource = keyof typeof DEFAULT_SLOT_LOCKS;

/** 与 `db.transaction` 回调拿到的句柄兼容的最小集合（照搬 work-project.ts 的写法）。 */
type DefaultSlotTx = Pick<typeof db, 'execute'>;

/**
 * 必须在「清掉其它默认」与「把自己设为默认」**之前**调用，且与两者同处一个事务。
 * 不打算设默认的请求不要调它——那会把无关的写入也串起来。
 */
export async function lockDefaultSlot(tx: DefaultSlotTx, resource: DefaultSlotResource): Promise<void> {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${DEFAULT_SLOT_LOCKS[resource]}, 0))`);
}
