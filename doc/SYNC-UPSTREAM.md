# 同步上游更新（maillab/cloud-mail）

本仓库是 `maillab/cloud-mail` 的 fork，并在其上做了 4 类定制。上游发新版时按本文操作。

## 当前基线

- 上游远端：`upstream` → `https://github.com/maillab/cloud-mail.git`（已配置）
- 上次同步的上游版本：`v3.5.0`
- 本地定制提交数：7（见 `git log --oneline upstream/main..main`）

## 标准流程

```bash
cd "E:/workbuddy/1943357913项目更新/cloud-mail"

git fetch upstream
git checkout -b sync/upstream-$(date +%m%d)     # 开分支，不在 main 上直接合
git merge upstream/main

# 逐个解冲突（对照下方清单），解完：
git add -A && git commit

# 本地验证：能打包即语法/依赖没问题
cd mail-worker && npx wrangler deploy --dry-run -c wrangler-dryrun.toml
cd ..

git push origin sync/upstream-xxxx              # 推分支不触发部署
```

确认无误后再合回 main 触发 CI：

```bash
git checkout main
git merge sync/upstream-xxxx
git push origin main
```

> 不要用 GitHub 网页的 “Sync fork” 按钮：它无法处理 workflow 文件的冲突，会把 CI 加固覆盖掉。

## 冲突清单（按风险排序）

| 文件 | 我们的定制 | 处理要点 |
|---|---|---|
| `mail-worker/src/service/email-service.js` | 渠道分流里的 Brevo 分支、4 处 `provider:` 传参 | 保住 `else if (brevoToken)` 分支、`sendBrevo` 生成器、`saveSentEmail` 的 `provider` 字段；Brevo 具体实现已移到独立文件，这里只剩薄薄几行 |
| `.github/workflows/deploy-cloudflare.yml` | `[assets]` 校验、部署后路由校验、冒烟测试、自动回滚 | **整份保留我们的版本**。若上游改了这里的步骤，只吸收与我们无关的改动（如 node 版本、step 命名），绝不能丢掉 assets 校验与回滚，否则会回到 `/api/*` 404 |
| `mail-worker/src/init/init.js` | `customMailDB()` 迁移 | 上游的 `vX_YDB` 迁移照单全收；我们的 `customMailDB` 保持在迁移链**最后一行**调用 |
| `mail-vue/src/views/sys-setting/index.vue` | Brevo Token 配置项、列表对话框 | 保留 `brevoTokenForm` / `brevoTokenList` / `saveBrevoToken` / `openBrevoForm` 与模板块 |
| `mail-worker/src/entity/email.js` | `provider` 列 | 与上游新增列并存即可 |
| `mail-worker/src/entity/setting.js` | `brevoTokens` 列 | 同上 |
| `mail-worker/src/service/setting-service.js` | brevoTokens 的解析 / 脱敏 / 合并 | 保住 `JSON.parse(brevoTokens)`、脱敏、含 `******` 视为未修改的逻辑 |
| `mail-worker/src/lib/email-list-columns.js` | brief 列加 `provider` | 一行，手工加回 |
| `mail-worker/package.json`、`mail-vue/package.json` | wrangler 及 vue 依赖升级 | 优先取上游版本，再按需升 wrangler |
| `*/pnpm-lock.yaml` | 依赖锁定 | **不要手解**：`git checkout --theirs -- */pnpm-lock.yaml`，然后 `pnpm install` 重新生成并提交 |

## 合并后自检（4 条，缺一不可）

1. **迁移函数没有重名**
   ```bash
   grep -n "async v[0-9_]*DB(c)" mail-worker/src/init/init.js
   ```
   出现两个同名（如都在定义 `v3_6DB`）说明对象属性被覆盖，其中一个迁移会静默失效 → 必须把自己那份改名。

2. **workflow 的加固还在**
   ```bash
   grep -c "run_worker_first\|Smoke test\|Rolling back" .github/workflows/deploy-cloudflare.yml
   ```
   三样都在才算没被上游覆盖。

3. **部署后查版本完整性**（CI 通过后）
   ```bash
   curl -s -H "Authorization: Bearer $CF_TOKEN" \
     "https://api.cloudflare.com/client/v4/accounts/$ACC/workers/scripts/cloud-mail/deployments" | head -40
   ```
   最新一条应当 `source=wrangler`、`percentage=100`，且版本 bindings 数量 = 10。出现 0 bindings 的空壳说明 Cloudflare 侧的 Git 自动构建又被打开了。

4. **发信三渠道可用**
   用 `admin@eve.edu.pl` 各发一封站内、一封站外，然后查：
   ```sql
   SELECT email_id, send_email, provider, resend_email_id
   FROM email WHERE type = 1 ORDER BY email_id DESC LIMIT 5;
   ```
   站内应为 `internal`，站外应为 `brevo` 或 `resend`（取决于该域名配了哪个 key）。

## 回滚

CI 自带两道保护：部署后路由校验失败或冒烟失败会自动把上一个版本提回 100%。
手动回滚：

```bash
curl -s -X POST \
  "https://api.cloudflare.com/client/v4/accounts/$ACC/workers/scripts/cloud-mail/deployments" \
  -H "Authorization: Bearer $CF_TOKEN" -H "Content-Type: application/json" \
  -d '{"strategy":"percentage","versions":[{"version_id":"<上一个好版本 uuid>","percentage":100}]}'
```

数据库迁移没有回滚（D1 不支持 DROP COLUMN 的稳妥写法），所以新增列务必带默认值。
