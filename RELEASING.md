# 发布流程

发布通过 GitHub Actions 完成，不使用本地发布。

参考：https://docs.npmjs.com/trusted-publishers

## 前置条件

- GitHub 仓库地址必须与 `package.json` 的 `repository.url` 一致。`publish.yml` 会在发布前校验。以下示例使用 `hiyms/pi-deepseek-web-tools`，请替换为实际仓库并同步修改 `package.json`。
- npm 包必须已经存在，才能配置 Trusted Publisher。首次发布使用 `bootstrap-publish.yml`。
- 工作流使用 Node 24 与 npm 11.5.1+，满足 Trusted Publishing 的要求。
- GitHub Actions 使用 GitHub 托管 runner。

## 首次发布

1. 在 GitHub 仓库 Secrets 中配置 `NPM_TOKEN`，使用具有发布权限的 granular access token。
2. 手动运行 `Bootstrap Publish` 工作流（`.github/workflows/bootstrap-publish.yml`）。它校验版本与测试后执行 `npm publish --access public`，创建 npm 包。
3. 打开 npmjs.com 的包设置 → Trusted Publisher → GitHub Actions，填写：
   - Organization or user：`hiyms`
   - Repository：`pi-deepseek-web-tools`
   - Workflow filename：`publish.yml`
   - Allowed actions：勾选 `npm publish`
4. 新配置必须在 2 天内完成一次 Trusted Publishing 发布，否则会过期。首次发布后建议在包设置 → Publishing access 选择 `Require two-factor authentication and disallow tokens`，然后删除 `NPM_TOKEN` secret。

也可以使用 npm CLI 配置 Trusted Publisher（需要 npm 11.15+、账号启用 2FA、包已存在）：

```bash
npm trust github pi-deepseek-web-tools --file publish.yml --repo hiyms/pi-deepseek-web-tools --allow-publish
```

## 后续发布

1. 更新 `package.json` 版本。`pnpm version patch` 会自动创建提交与标签；手动修改时自行提交并创建标签。
2. 推送提交与标签：

```bash
git push origin main --tags
```

`Publish` 工作流只在新增 `v*` 标签时触发，执行：

- 校验标签与 `package.json` 版本一致。
- 校验 `repository.url` 与 GitHub 仓库一致。
- 校验 npm 上包已存在。
- `pnpm install --frozen-lockfile`、typecheck、测试。
- 已发布的版本会跳过，重复推送标签不会失败。
- 预发布版本（版本号带 `-`，如 `0.1.0-alpha.2`）发布到对应的 dist-tag（`alpha`、`beta`、`rc`；后缀不以字母开头时为 `next`），正式版本发布到 `latest`。因此预发布不会改变 `npm install pi-deepseek-web-tools` 安装到的版本。
- `npm publish --access public` 使用 OIDC Trusted Publishing，公开仓库与公开包自动生成 provenance。

私有仓库不生成 provenance，发布仍可使用 Trusted Publishing。发布目标由 `publishConfig.registry` 固定为 `https://registry.npmjs.org/`。
