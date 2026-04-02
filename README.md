# ME

## 维护脚本

```bash
pnpm run --filter @apps/webapp generate:auth:secret
pnpm run --filter @apps/webapp generate:auth:schema
pnpm run --filter @apps/webapp generate:drizzle:schema
pnpm run --filter @apps/webapp generate:drizzle:migrate
pnpm run --filter @apps/webapp generate:payload:schema
pnpm run --filter @apps/webapp generate:payload:types
pnpm run --filter @apps/webapp generate:payload:migrate
pnpm run --filter @apps/webapp generate:payload:migrate:create
```
