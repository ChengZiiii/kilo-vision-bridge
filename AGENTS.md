# AGENTS.md — Kilo Vision Bridge 开发规则

## 项目简介

给纯文本模型（GLM-5.2、DeepSeek 等）"眼睛"的 Kilo 插件。核心能力：注册原生
`vision_analyze` 工具 + `vision-agent` 子代理回退，让文本模型能对截图/图片做
结构化视觉判断（返回模板 JSON）。

- 行为规范：`openspec/specs/vision-bridge/spec.md`（改行为前必读）
- 用户文档：`README.md`
- 主代理：`libretto`（规格驱动开发，见下文 OpenSpec 工作流）

## 架构总览

| 文件 | 职责 |
| ---- | ---- |
| `plugin.ts` | 插件入口：config hook（注册 agent/skill、捕获模型旋钮）、`tool` hook（注册 `vision_analyze`）、`permission.ask`、messages/system transform、skill 自动同步 |
| `src/vision-http.ts` | 纯函数核心：请求构建、响应解析、endpoint/API key 解析、HTTP 调用。**无 @kilocode 依赖、无副作用**——plugin.ts 打包它，tests 直接 import 它 |
| `SKILL.md` | 视觉意图检测与委托路由（工具优先 → 子代理回退） |
| `tests/vision-http.test.mjs` | node:test 单测（stub `globalThis.fetch`） |
| `dist/index.js` | 构建产物，**自包含**（内含 @kilocode/plugin + zod，见关键设计决策） |

## 视觉路由机制（改行为前必读）

1. **多模态模型**：图片 FilePart 原样直达，system transform 注入 `[vision:native]`，
   明确禁止委托。
2. **纯文本模型**：messages transform 把图片落盘到
   `<系统临时目录>/kilo-vision-bridge/` 并改写为 `[vision:dropped-image]` 标记 →
   SKILL.md 引导调用 `vision_analyze` 工具。
3. **工具错误分类（skill 据此分支，勿乱改前缀）**：
   - `model not configured` → 提示用户配置，**不回退**子代理
   - `provider error` → 回退派发 `vision-agent` 子代理
   - `invalid response` → skill Step 6 重试一次
   - `missing image` → 报错并指名路径，不发请求
4. **模型旋钮**：唯一入口是 `agent["vision-agent"].model`（插件**绝不写入**
   `model`/`disable`）；`disable: true` 同时关闭工具注册与子代理。

## 开发循环

1. 编辑 `plugin.ts` / `src/` → 重建 dist → 重启 Kilo → 测试：
   ```powershell
   # 常驻自动重建
   bun build ./plugin.ts --outfile ./dist/index.js --target node --format esm --watch
   # 或一次性：bun run build
   ```
2. **SKILL.md 改动零手动**：启动时自动同步到
   `~/.config/kilo/skills/vision/SKILL.md`（字节一致跳过写入）。
3. **沙盒隔离测试**（不污染真实配置）：
   ```powershell
   $env:KILO_CONFIG_DIR = "<临时>/config"
   $env:KILO_TEST_HOME   = "<临时>/home"
   $env:KILO_DATA_DIR    = "<临时>/data"
   kilo
   ```
4. **排错**：`kilo --print-logs --log-level DEBUG` 看插件加载错误；
   改动不生效先清 `~/.cache/kilo` 插件缓存。

## 测试与构建（硬性检查）

```powershell
node --test tests/*.test.mjs   # 单测。注意：Node 24 下 `node --test tests/` 目录形式不可用
bun run typecheck
bun run build
```

- 所有纯逻辑改动必须带/更新单测（stub fetch 即可，无需真实 API）。
- **build 严禁加 `--packages external`**：dist 必须自包含——单文件安装
  （Method B）没有 node_modules，运行时无法解析 `@kilocode/plugin`。

## 关键设计决策（勿轻易推翻，改前先讨论）

1. **双请求形状**：OpenAI `/chat/completions`（`data:` image_url）与 Anthropic
   `/messages`（base64 image 块），按 endpoint URL 是否含 `/anthropic` 选择。
   原因（实机验证）：`api.minimaxi.com` 的 OpenAI 兼容端点会**静默丢弃 `data:`
   图片**（模型答"无图"），Anthropic 风格端点才能送达。内置 endpoint 映射
   （minimax 家族）指向 anthropic 风格 URL。
2. **`permission.ask` 钩子在 Kilo 7.4.17 从不被派发**：自定义工具未配置权限时
   天然无提示；用户显式 `deny` 会把工具**移出会话工具集**（比移除工具描述更强）。
   钩子保留作为未来运行时兼容（只升 `ask→allow`，永不覆盖 `deny`）。
3. **图片字节不经过 shell**：base64 经 Node 读写（`readFileSync`/`writeFileSync`），
   禁止把 base64 塞进命令行——截图可能含敏感内容，不能进 shell 历史。
4. **endpoint/key 解析顺序**（勿乱改）：config `options.baseURL` → provider env
   中 `*_HOST` 类变量 → catalog `api` 字段 → 内置映射 → 明确报错。
   key：auth.json（type `api`）→ provider env 变量。
5. **开关语义**：`agent["vision-agent"].disable = true` = 一键全关（工具 + 子代理），
   这是用户唯一认可的关闭方式。

## 安装方式

三种方式任选其一（插件 id 均为 `"vision"`，**并存会重复注册冲突**）：

- **A（推荐）**：`kilo.jsonc` 的 `plugin` 数组写本地包路径
  `"file:///<仓库绝对路径>"`（本地仓库即包，本地开发最方便）。skill 自动同步。
- **B（单文件）**：复制 `dist/index.js` 到 `~/.config/kilo/plugin/vision.js`；
  **skill 需手动复制**到 `~/.config/kilo/skills/vision/SKILL.md`。
- **npm**：发布后 `kilo plugin kilo-vision-bridge --global` 安装并自动 patch
  配置。切换时先删掉旧安装（`kilo.jsonc` 里的 `file://` 条目或旧单文件）。
- `~/.config/kilo/skills/vision/` 是插件自动维护的镜像缓存，可删可留（启动自愈）。

## OpenSpec 规格工作流（libretto）

所有**行为改动**走完整流程，禁止直接改代码：

```
explore → propose → 用户批准 → apply → verify → archive
```

1. `openspec new change <kebab-name>`，写 proposal / specs(deltas) / design / tasks
2. delta spec 规则：
   - 只写变化：`## ADDED` / `## MODIFIED` / `## REMOVED Requirements`
   - **MODIFIED 块必须携带主 spec 中该需求的全部既有场景**，否则归档会拒绝
     （`archive_spec_update_failed`）
   - 场景用 Given/when/then，需求用 SHALL
3. 校验：`openspec validate --all`
4. 实施（libretto-apply）→ 三维验证（libretto-verify，只报告不改码）
5. **实现与 spec 出现偏差时，先改 delta spec 再归档**（spec 是事实源）
6. 归档：`openspec archive <name> --yes`（先 validate，拒绝时按报错修 delta）
7. 提交按 conventional 风格：`plugin:` / `skill:` / `tests:` / `docs:` / `chore:`

## 工作流主代理说明

本仓库主代理为 `libretto`（规格驱动）。`compose` 系（TDD 工作流）亦可使用，
但**任何行为改动仍须先有 openspec 变更**。视觉相关改动必须保持
`agent["vision-agent"].model` 旋钮、错误分类前缀、开关语义三者的向后兼容。
