# AudioDock 项目长期记忆

> 精简版。细节查 `docs/` 与每日日志。

## 仓库与协作约定
- 远程 `git@github.com:NasDock/AudioDock.git`，分支 `feat/test`；`.workbuddy/memory/` 日志随代码提交。
- bash `grep` 静默无输出 → 一律用 Grep 工具；`eslint .` 多目录撞 EPIPE，分目录跑。
- @soundx/services 与 @soundx/ws 入口指 `dist`，改 `src/` 后必须各自 `pnpm build`。
- 用户偏好：代码先于 UI（新接口先落 service/model 类型）；soft-disable 用注释；报告用表格、简洁中文。
- 本地 API 验证：3000 端口用户常驻 `node dist/main`（CWD=services/api 才能加载 .env 的 JWT_SECRET，否则全部 401）；测试用 `PORT=3001` 起临时实例，JWT_SECRET 在 `services/api/.env`，dev.db 在 `packages/db/prisma/`。

## API 鉴权（含 access token，2026-11-18）
- 全局 `JwtAuthGuard`（APP_GUARD）：`@Public()` 放行 → `x-access-token` 头走令牌校验 → 否则 passport JWT（`Authorization: Bearer`）。
- access token：库只存 SHA-256 hash+前缀，明文仅创建时返回一次；屏蔽前缀 `/user` `/auth` `/admin` `/access-tokens` `/scan-login`（命中 403）；无效/停用 401。
- `/auth/check` 是 **@Public 智能探针**（2026-11-18 改）：无凭证→200（登录前连通性探测）；带 JWT/access token 则校验，失效→body 401（desktop Header / mobile _layout 仅靠这个 401 自动登出，不能删）。desktop 登录页 `tryAddress` 把 401 视为可达（防过期 token 死锁）。
- HttpExceptionFilter 把所有异常包成 HTTP 200 + body code，客户端永远看 body code 不看 HTTP status（desktop 拦截器里 status===401 的分支是死代码）。
- services/api 无全局前缀；`/api/*` 是 nginx（9958）/vite dev 代理 rewrite 掉的前缀。

## 飞牛音乐（fnOS trim.music）
- 网关 `/music/api/v1`，信封 `{code,msg,data}`；登录 `POST /user/password-login`（密码 SHA-256 hex、deviceId 32 位 hex）；会话 `Authorization: <userToken>`（无 Bearer）。
- 媒体接口只认 Authorization 头；FN Connect 中继（`*.fnos.net`/`*.5ddd.com`）必须 `Cookie: mode=relay`（适配器 `buildHeaders()` 自带）。RN 的 `URL` 是存根 → 纯字符串解析；RN 设 Cookie 头必须 `credentials:'omit'`。
- 飞牛强制 MUSIC、不能注册、无搜索历史；列表无 lyrics，`GET /lyric/list?trackGUID=` 懒加载。文档 `docs/fnos-music-api.md`。
- 各端媒体：desktop web→`/__fnos` 代理；Tauri→`src-tauri/src/fnos_media.rs` 回环；mobile→组件带 headers；hm→落盘/AVPlayer 带 headers；mini 暂不接入（无 header 能力）。
- `useFnosAdapter` 改名导入 `as activateFnosAdapter` 规避 hooks 误报。

## deviceId / 设备与流转
- `computeDeviceId`（`packages/ws/src/deviceId.ts`）= md5(clientType␟osName␟osVersion␟brand␟manufacturer␟model␟deviceName) 前 12 位 + 端前缀，五端同步；禁随机 ID。持久化 key `audiodock_device_id`（mobile 带 `@`）。
- 多端必须连同一服务端（同一 dev.db）。vite dev 必须代理 `/socket.io`（ws:true），target 用 `127.0.0.1`；socket.io-client 把 path 当 namespace → `normalizeSocketUrl()` 剥路径；按 url|token|userId|deviceId signature 判断重连。
- mobile socket 用 HTTP `getBaseURL()`，AppState 回前台重连；`setDeviceOffline` name 兜底带 platform。
- 目标离线服务端暂存流转 10min 补投；端侧兜底 REST `POST /user/devices/transfer`；ack 三态不重发。生效顺序：ws build → api 重启 → vite 重启 → 各端重连。

## harmony（ArkTS）
- 构建：`DEVECO_SDK_HOME=<DevEco>/Contents/sdk`，`env -u NODE_OPTIONS`，`cd apps/harmony && hvigorw --mode module -p product=default -p module=entry@default assembleHap --no-daemon`；构建后跑 `scripts/harmony-cleanup.sh`。
- 禁对象 spread/`as const`/indexed access；FontWeight 六种；@Builder 无 const/if；8 位 hex=`#AARRGGBB`；悬浮用 Stack 兄弟层 + hitTestBehavior(None)。
- LRCParser.time 是**毫秒**（mobile 是秒）。小部件 preferences `audiodock_kv` 用 getFresh/getJSONFresh；卡片只认 data: URI，>80KB 封面压缩；播控必须 call 事件。
- VIP：EntryAbility 恢复 `plus_token`→`setPlusAuthToken`；判定 `plusApi.getMe → vipTier !== 'NONE'`。AVSession 首次真播放才 activate。

## desktop
- 严禁模块顶层调 hook；backdrop-filter 毁 position:fixed；外链一律 `tauriOpenExternal`。
- 版本更新走 `GET /download/latest?product=audiodock`；MinIO 预签名 5 分钟，点下载时重拉。
- Tauri/Windows：创建新 webview 窗口的 command 必须 async（同步死锁白屏）；任务栏缩略图 `src-tauri/src/taskbar_thumb.rs`。

## mobile 播放状态（2026-11-08）
- AsyncStorage 6MB 上限 → savePlaybackState 瘦身（剥 lyrics/嵌套数组）+ 队列窗口 ±50，否则写入失败、冷启动 mini 播放器不展示。
- 恢复路径绝不出声：`suppressAutoResumeRef` 初始 true，仅 playTrack/playTrackList/resume 清除；contentMode 竞态要 `modeLoaded` 闸门。
- CarPlay：react-native-carplay@2.4.1-beta.0 裸 RN 集成；JS `src/services/carplay.ts` + `carplayBridge.ts`；双 SceneDelegate，新文件手工注入 pbxproj 四处。

## 跨端
- 横屏封面轮播（hm+mobile）：横屏 && 高<500 && queue>1；锚点 1:2:3；effPos = idx − posAnim；**堆叠靠渲染顺序不靠 zIndex**；窗口 ±3；封面 ≤300 档。
- 四端缓冲进度条：Slider 底轨透明 + 下叠自绘层。
- 版本更新弹窗：`classifyRelease(body, platform)`（conventional commit scope 过滤），三端别名表同步。
- 歌词手动滚动（2026-11-14 四端统一）：拖动接管→中心行时间戳+播放键→点击 seek 恢复→2s 未操作**显式**回弹。mobile `LyricsScrollArea.tsx`（半屏留白放行容器自身，不能放 contentContainerStyle）；desktop `Player/Lyrics.tsx`（autoScrollingRef+scrollend）；mini `pages/player/index.tsx`（scrollIntoView 先清空再设回、无 onLayout 用 createSelectorQuery）；hm `PlayerPage.ets`（onScrollIndex center 需 ref 屏蔽、轻点≠拖动：Down 只记起点 Move 超阈值才接管）。
- mini→全屏封面/主题色预热（2026-11-16）：mobile `PlayerProvider`+`playerVisualPrefetch.ts`；hm `PlayerStore.notify()`+`coverCache.ets`（ArkUI Image 与 http 不共享缓存须落盘）；预热失败即清缓存；预取与渲染 URL 必须同一构造函数。desktop 天然无问题（Player 常驻 Routes 外）。
- mini 会员支付：plusWechatMpSession→openid；下单 clientType:'miniprogram'+openId；返回 wechatPay 喂 Taro.requestPayment。
- services/mi 小爱音箱：sqlite3 走 asyncio.to_thread；唤醒词 DB 优先；API 前缀 /api；docker 挂 auth.json/.mi.token/data/。
- CI：Android job 不用 android-actions/setup-android@v3，ubuntu-latest 自带 SDK。
