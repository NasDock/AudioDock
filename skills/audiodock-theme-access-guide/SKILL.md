---
name: audiodock-theme-access-guide
version: 1.2.9
description: AudioDock 两大用户功能的使用说明——(0) 使用前准备：服务端地址、访问凭证（JWT / access token）、Swagger 接口文档地址；(1) desktop/mobile 的 UI 主题插件（上传 JSON 自定义界面/播放器皮肤，VIP 专属，含 schema 与兼容契约）；(2) 访问控制（JWT 登录、access token 访问令牌的管理与调用、屏蔽前缀、/auth/check 探针、管理员权限）。当被问到"服务端地址是什么""Swagger 文档地址""怎么拿 token/访问令牌""怎么用主题插件/UI 插件/播放器主题""怎么导入自定义主题""怎么创建/使用 access token""鉴权/401 怎么处理"时使用本 skill。
---

# AudioDock 主题插件与访问控制使用指南

本 skill 面向"怎么用"，覆盖两个功能域。**两者都是会员（VIP）相关能力**：主题插件完全限 VIP，访问令牌管理入口限管理员。版本号与仓库根 `package.json` 对齐（当前 `1.2.9`）。

---

## 第零部分：使用前准备（服务端地址 / token / Swagger）

调用任何接口或使用客户端前，先确认以下三项。把本 skill 交给别人（或 AI 助手）代操作时，**这三项通常需要由使用者提供**。

### 0.1 服务端地址（API Base URL）

客户端填的"服务端地址"就是 API 根地址，**不带 `/api` 后缀**（`/api/*` 是 nginx / vite dev 代理加的前缀，转发时被 rewrite 掉）：

| 场景 | 服务端地址 | 说明 |
|---|---|---|
| 本地开发 | `http://127.0.0.1:3000` | API 默认 3000；**必须在 `services/api` 目录启动**，否则 `.env` 的 `JWT_SECRET` 加载不到 → 全部 401 |
| Docker / NAS | `http://<NAS-IP>:8860` | `docker-compose.yml` 把容器 `3000` 映射为宿主 `8860`（Node API 直连） |
| 走 nginx Web UI | `http://<host>:9961` | nginx 容器 `9958` 映射为宿主 `9961`；同源 `/api/*` 由 nginx rewrite 到后端 |

> 两个端口别混：nginx 端口（9958 / 宿主 9961）给 Web UI 同源调用；API 直连端口（3000 / 宿主 8860）给客户端 App、脚本和 Swagger 用。

### 0.2 访问凭证（token）

两种凭证，按调用方选其一（详见第二部分）：

| 凭证 | 获取方式 | 携带请求头 | 适用范围 |
|---|---|---|---|
| **JWT 登录令牌** | `POST <服务端地址>/auth/login`，body `{username, password}`，取返回 `data.token` | `Authorization: Bearer <token>` | 全部接口（含管理接口） |
| **access token 访问令牌** | 登录后 `POST <服务端地址>/access-tokens` 创建（`{name}`），**明文仅返回一次** | `X-Access-Token: adk_<...>` | 除 `/user` `/auth` `/admin` `/access-tokens` `/scan-login` 外的接口 |

- 普通客户端（desktop/mobile）自动用 JWT，无需用户提供；**第三方脚本/AI 代调接口时才需要用户手动提供凭证**。
- 判断成败看响应体 `code` 字段（见 2.3 状态码陷阱），不是 HTTP status。

### 0.3 Swagger 接口文档地址

Swagger 由 `SwaggerModule.setup('api', app, document)` 挂在 **API 服务本身**：

| 项 | 地址 |
|---|---|
| Swagger UI | `<API 直连地址>/api`，如本地 `http://127.0.0.1:3000/api`、NAS `http://<NAS-IP>:8860/api` |
| OpenAPI JSON | `<API 直连地址>/api-json` |

> ⚠️ 注意：nginx 的 `location /api/` 会把 `/api` 前缀 rewrite 掉（见 `nginx.conf:46-52`），所以**通过 nginx 端口（9961）访问 `/api` 拿不到 Swagger**——Swagger 要走 API 直连端口。同理，业务接口的 Swagger 路径显示为 `/xxx`，本地直连直接请求 `/xxx`，通过 nginx 才加 `/api` 前缀。
>
> Swagger 未配置 Bearer 授权按钮（代码中无 `addBearerAuth`），"Try it out" 调试受保护接口时需在请求头手动带上 0.2 的凭证。

---

## 第一部分：UI 主题插件（desktop / mobile）

### 0. 先分清三个"插件"（最易踩坑）

| 概念 | 位置 | 与主题有关？ |
|---|---|---|
| **UI 主题插件 / 播放器主题** | desktop `apps/desktop/src/config/uiPluginSchema.ts`；mobile `apps/mobile/src/config/playerThemeSchema.ts` | ✅ 本部分讲的就是它，VIP 专属 |
| **元数据插件 MetadataPlugin** | `packages/services/src/metadataPlugins.ts`、`apps/desktop/src/pages/Settings/PluginCenterSettings.tsx`、`apps/mobile/app/plugin-center.tsx` | ❌ 抓歌曲元数据/封面，管理员专属 |
| **plugin-runtime** | `packages/plugin-runtime/dist/*`（仅有编译产物） | ❌ 全仓零引用，未接入，别当成主题运行时 |

入口话术：desktop = **设置 → 插件 → UI 插件**；mobile = **设置 → 播放器主题**。都不是"插件中心"（那是元数据插件）。

### 1. 使用前提

- **必须 VIP**：非会员/未登录时控件全部禁用，提示"UI 插件仅会员可用"并引导开通。判定走 `plusGetMe → vipTier !== 'NONE'`（desktop `hooks/useUiTheme.ts` 的 `useLocalVipStatus`、mobile `app/player-theme.tsx` 的同名 hook）。
- **导入 ≠ 生效**：导入后必须再点"启用/使用"。
- 主题是**纯客户端**功能：desktop 存 localStorage（zustand persist），mobile 存 AsyncStorage；**没有服务端主题市场**，没有从服务端拉取的主题列表。

### 2. Desktop 怎么用

入口：`apps/desktop/src/pages/Settings/index.tsx` 的 `plugins` tab → 锚点 `plugins--uiPlugin` → `<UIThemeSettings />`（`pages/Settings/UIThemeSettings.tsx`）。

| 操作 | 做法 |
|---|---|
| 拿模板 | 点"下载示例插件"→ 导出 `audiodock-ui-theme.sample.json`（内容 = `docs/ui-theme.example.json`） |
| 导入 | 拖拽/点击上传 `.json` → `importTheme(text, fileName)` → 校验通过存入 store |
| 启用 | 在列表里点"启用"（`setActive(id)`）；"停用" = `setActive(null)` |
| 删除 | 列表项"删除"（`removeTheme(id)`），带二次确认 |
| 内置皮肤（非插件） | 全屏播放页 → 格式刷图标 → 播放器样式（默认/黑胶）、歌词对齐、歌词字号 12–28 |

校验失败弹错误、有 warning 弹"已导入，存在 N 项告警（未知键或格式异常，已保留）"。

**应用机制**（`apps/desktop/src/hooks/useUiTheme.ts`）：
1. `App.tsx` 调 `useUiTheme()` → `getThemeConfig(mode, uiPlugin)`（`@soundx` antd `ConfigProvider` theme），三处挂载 `ConfigProvider`。
2. effect 里 `applyComponentCssVars(tokens, skinTokens)` 写 `:root` 的 `--ad-*` CSS 变量：**先写本地皮肤 base，再写用户插件 override（插件优先）**，切换前先清空旧变量。
3. 播放详情页特殊：用 `getThemeConfig("dark", ...)` + `inherit:false` 强制暗色，避免浅色主题把深色背景文字染黑（`components/Player/index.tsx`）。
4. 派生变量：`lyricsAlign`→justify、`lyricsColumnRatio`→flex、`lyricsFontSize`+2px = 当前行字号。

**关键文件**：`config/uiPluginSchema.ts`（`validateUiTheme` L162）、`config/themeConfig.ts`（`getThemeConfig` L26）、`store/uiTheme.ts`（persist key `soundx-ui-themes`）、`hooks/useUiTheme.ts`、`store/playerSkin.ts`（persist key `audiodock-player-skin`）、`components/Player/SkinSettings.tsx`。

### 3. Mobile 怎么用

入口：`apps/mobile/app/settings.tsx` 通用区"播放器主题" → `router.push("/player-theme")` → `app/player-theme.tsx`（注意 `/plugin-center` 是元数据插件，别混）。

| 操作 | 做法 |
|---|---|
| 导入 | 在文本框**粘贴 JSON** + 点"从剪贴板粘贴" + 点"导入主题"（`playerThemeStore.importTheme`） |
| 使用 | 列表选主题单项激活；"默认样式" = `setActive(null)` |
| 编辑 | 主题行铅笔图标 → 全屏 Modal 预填 JSON → 保存走 `updateTheme()`（保留激活态，desktop 无此能力） |
| 删除 | 主题行删除（`removeTheme`） |
| 内置皮肤（非插件） | 播放页"更多" → "播放器样式" → 默认/黑胶（`PlayerMoreModal.tsx`），只写 `playerSkin` |

**没有文件选择器、没有示例下载按钮、没有内置预设主题**——移动端主题需自行按 schema 编写 JSON。

**应用机制**（`apps/mobile/src/hooks/usePlayerTheme.ts`）：
- `usePlayerTheme()`：非 VIP 返回 null；`theme === "dark" || "festive"` 取 `plugin.dark.player`，否则 `light.player`。
- `app/player.tsx` 逐键 `?? 默认值` 消费（background/titleColor/lyricsColor/coverRadius/...），直接进 RN inline style，无 CSS 变量。
- 优先级：插件 > 本地皮肤 > vinyl 默认；歌词字号"最后一次操作生效"（主题激活时设值，用户手动调整随后覆盖）。

**关键文件**：`src/config/playerThemeSchema.ts`（`validatePlayerTheme` L125）、`src/store/playerTheme.ts`（AsyncStorage key `soundx-player-themes`，手写 store + `useSyncExternalStore`，模块加载即 `hydrate()`）、`src/store/playerSkin.ts`（key `audiodock-player-skin`）、`src/components/PlayerMoreModal.tsx`、`app/player.tsx`、`src/context/ThemeContext.tsx`（light/dark/festive）。

### 4. 自定义主题 JSON（核心）

两端机制同源（schemaVersion=1 + 部分覆盖 + 未知键保留 + warning 不失败），但**键表独立、文件不通用**。权威文档：`docs/ui-theme-schema.md` + `docs/ui-theme.example.json`；社区示例 `docs/themes/{deep-blue-gradient,netease-cloud,red-white}.json`（仅文档资源，代码不加载）。

**通用兼容契约**：`meta.schemaVersion` 必填且 = 1；未知键不报错不剥离、保留待升级生效；缺省键回退默认；颜色/尺寸/枚举/比例各有类型约束；扩展"只增不改"。

**Desktop 模板**（无 `platform` 字段；`global` + `components.{header,player,home,detail}`）：

```json
{
  "meta": { "name": "acme-midnight", "author": "acme", "version": "1.0.0", "schemaVersion": 1 },
  "dark": {
    "global": { "colorPrimary": "#7c5cff", "colorBgBase": "#0d0d12", "borderRadius": 10 },
    "components": {
      "header": { "background": "rgba(20,20,28,0.55)", "blur": 24 },
      "player": { "progressColor": "#7c5cff" },
      "home":   { "cardBackground": "rgba(255,255,255,0.05)" },
      "detail": {
        "lyricsAlign": "center", "lyricsColumnRatio": 0.6,
        "lyricsFontSize": 18, "coverStyle": "vinyl", "tonearm": "basic"
      }
    }
  }
}
```

- `global` 8 键：`colorPrimary/colorBgBase/colorBgContainer/colorText/colorTextSecondary/colorBorder/borderRadius/fontFamily`。
- `detail` 键：`background/blur/controlsBackground/controlsTextColor/lyricsAlign(left|center|right)/lyricsColumnRatio(0-1)/lyricsFontSize(px)/coverStyle(square|vinyl)/tonearm(none|basic)`。
- 颜色支持任意 CSS 颜色含 `linear-gradient(...)`；`px`/`ratio`/`enum` 有类型约束（见 schema 文档）。

**Mobile 模板**（**必须** `meta.platform === "mobile"`，否则直接拒绝；只有 `player` 命名空间）：

```json
{
  "meta": { "name": "acme-mobile-dark", "schemaVersion": 1, "platform": "mobile" },
  "dark": {
    "player": {
      "background": "#0d0d12",
      "headerIconColor": "#e6e6eb",
      "titleColor": "#ffffff",
      "artistColor": "#9a9aa5",
      "coverRadius": 12,
      "coverStyle": "vinyl",
      "tonearm": "basic",
      "lyricsColor": "#8a8a95",
      "lyricsActiveColor": "#7c5cff",
      "lyricsFontSize": 18,
      "lyricsAlign": "center",
      "progressColor": "#7c5cff",
      "controlColor": "#e6e6eb"
    }
  }
}
```

- `player` 13 键：`background/headerIconColor/titleColor/artistColor/coverRadius/coverStyle/tonearm/lyricsColor/lyricsActiveColor/lyricsFontSize/lyricsAlign/progressColor/controlColor`。
- 颜色**不支持 gradient**（hex/rgb/hsl/named）；`coverRadius/lyricsFontSize` 为非负数字。
- 两类文件互不能跨端使用：desktop 主题缺 `platform:"mobile"` 会被 mobile 拒绝；mobile 主题套到 desktop 也对不上命名空间。

### 5. 两端差异速查

| 维度 | Desktop | Mobile |
|---|---|---|
| Schema | `uiPluginSchema.ts` | `playerThemeSchema.ts` |
| 命名空间 | global + header/player/home/detail/pages | 仅 player |
| 隔离标记 | 无 `platform` | 强制 `platform:"mobile"` |
| 应用 | antd ConfigProvider + `--ad-*` CSS 变量 | RN inline style |
| 存储 | zustand persist / localStorage | 手写 store / AsyncStorage |
| 导入 | 上传 `.json` + 下载示例 | 粘贴文本 + 剪贴板 |
| 编辑 | 无 | `updateTheme()` 原位编辑 |
| 皮肤项 | 封面样式 + 歌词对齐 + 字号 | 仅封面样式 |
| 模式 | light/dark | light/dark/festive（festive 取 dark 段） |

---

## 第二部分：访问控制（鉴权 / access token）

### 1. 两种凭证，别混淆

| 凭证 | 头 | 用途 | 谁用 |
|---|---|---|---|
| **JWT（登录令牌）** | `Authorization: Bearer <jwt>` | 正常登录态，端点 `/auth/login`（**没有 `/auth/password-login`**，那是飞牛数据源登录） | desktop/mobile 客户端自动注入 |
| **access token（访问令牌）** | `X-Access-Token: <token>` | 第三方工具/脚本远程调接口（如改元数据） | 脚本、远程调用；两端应用代码**不发**此头 |

全局守卫 `JwtAuthGuard`（`services/api/src/app.module.ts` 以 `APP_GUARD` 注册，`auth/jwt-auth.guard.ts`）判定顺序：
1. `@Public()` 路由 → 直接放行；
2. 有 `x-access-token` 头 → 校验访问令牌；
3. 否则 → passport JWT（Bearer，`auth/jwt.strategy.ts`）。

### 2. 访问令牌怎么用（管理员）

**UI 入口**：desktop `/admin/access-tokens`（`pages/Admin/AccessTokenManagement/index.tsx`）；mobile 设置页"访问令牌"（`app/access-tokens.tsx`，受 `user?.is_admin` 显隐）；mini `src/pages/access-tokens/`。

**管理接口**（均需 JWT 登录，**令牌本身不能管理令牌**）：

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/access-tokens` | 列出自己的令牌 |
| POST | `/access-tokens` | body `{name}`，**明文仅此一次返回**（`data.token`），须立即保存 |
| PUT | `/access-tokens/:id` | `{name?, enabled?}` 改名/启停 |
| DELETE | `/access-tokens/:id` | 硬删除 |

共享 service：`packages/services/src/accessToken.ts`（`getAccessTokens/createAccessToken/updateAccessToken/deleteAccessToken`），类型在 `packages/services/src/models.ts`（`AccessToken`/`AccessTokenWithSecret`）。

**调用业务接口**：任意允许的接口带 `X-Access-Token: adk_xxxx...` 即可，无需 JWT。

**令牌机制**（`services/api/src/services/access-token.service.ts`）：
- 明文格式 `adk_` + 48 位 hex（`randomBytes(24)`）；DB 只存 `tokenHash`（SHA-256）+ `tokenPrefix`（前 10 字符），不存明文。
- `resolve()` 按 hash 查库、校验 `enabled`，异步刷新 `lastUsedAt`；无效/停用返回 null。
- 数据模型：`packages/db/prisma/schema.prisma` 的 `model AccessToken`。

**屏蔽前缀**：`/user`、`/auth`、`/admin`、`/access-tokens`、`/scan-login`（精确或带 `/` 前缀匹配，不误伤 `/user-track-likes`）。即令牌**不能**操作用户/登录态/令牌自身/管理员接口；即使令牌属管理员也访问不了 `/admin/*`。

### 3. 状态码陷阱（必读）

`HttpExceptionFilter`（`services/api/src/filters/http-exception.filter.ts`）把所有异常包成 **HTTP 200 + body `{code, message, data:null}`**。客户端**永远看 body.code，不看 HTTP status**：

| 场景 | body.code |
|---|---|
| 令牌无效/停用、无凭证访问受保护接口、登录过期 | `401` |
| 令牌命中屏蔽前缀、非管理员访问 admin | `403` |
| 参数错误 / 资源不存在 | `400` / `404` |

> desktop `https/index.ts` 响应拦截器里 `HTTP 401 → logout()` 对鉴权失败是**死代码**（filter 已包成 200）。自动登出实际只靠 `/auth/check` 的 body code 401。

### 4. `/auth/check` 智能探针（自动登出的命脉）

`services/api/src/auth/auth.controller.ts` 的 `check()`，`@Public()`：
- **无任何凭证** → `code:200, data:true`（登录页探测服务器可达）；
- 带 `x-access-token` → 校验令牌，无效 `code:401`；
- 带 `Authorization: Bearer` → `verifyToken`，过期 `code:401`。

客户端：desktop `components/Header/index.tsx`、mobile `app/(tabs)/_layout.tsx` 都在启动时 `check()`，见 `code===401` 即 `logout()`。desktop 登录页 `tryAddress()` 把 401 视为"地址可达"，避免 token 过期导致无法重新登录的死锁。**改动 `/auth/check` 前务必确认这两处自动登出链路。**

### 5. 管理员权限

- 无 `@Roles`/`RolesGuard`/`AdminGuard`；靠 `User.is_admin`（prisma schema）+ 控制器内手写 `checkAdmin()`（`controllers/admin.controller.ts`、`controllers/metadata-plugins.controller.ts`），抛 `ForbiddenException('需要管理员权限')`。
- 首个注册用户自动提升为管理员（`services/user.ts` 的 `createUser`，`count===0 → is_admin=true`）。
- 客户端 UI 用 `user?.is_admin` 控制管理员入口显隐。
- JWT 有效期 `100y`；`JWT_SECRET` 来自 `JWT_SECRET` 环境变量，否则读 `process.cwd()/.jwt_secret`（不存在则生成）——**必须在 `services/api` 目录启动**，否则 secret 不一致导致 401。

### 6. 关键文件速查

| 主题 | 文件 |
|---|---|
| 全局守卫/过滤器 | `services/api/src/app.module.ts`、`auth/jwt-auth.guard.ts`、`filters/http-exception.filter.ts` |
| JWT 策略/登录 | `auth/jwt.strategy.ts`、`auth/auth.controller.ts`、`auth/auth.service.ts`、`config/jwt.config.ts` |
| 访问令牌 | `controllers/access-token.controller.ts`、`services/access-token.service.ts`、`packages/services/src/accessToken.ts` |
| @Public | `common/public.decorator.ts` |
| 客户端登出 | desktop `components/Header/index.tsx`；mobile `app/(tabs)/_layout.tsx` |

> 仓库 `docs/` 下**没有**专门的访问控制文档；事实设计记录在 `.workbuddy/memory/2026-11-17.md`、`-18.md`、`-19.md`。
