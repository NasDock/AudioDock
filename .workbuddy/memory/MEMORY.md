# AudioDock 项目长期记忆

> 精简版。细节查 `docs/` 与每日日志。

## 仓库与协作约定
- 远程 `git@github.com:NasDock/AudioDock.git`，分支 `feat/test`；`.workbuddy/memory/` 日志随代码提交。
- bash `grep` 静默无输出 → 一律用 Grep 工具；`eslint .` 多目录撞 EPIPE，分目录跑。
- @soundx/services 与 @soundx/ws 入口指 `dist`，改 `src/` 后必须各自 `pnpm build`。
- 用户偏好：代码先于 UI（新接口先落 service/model 类型）；soft-disable 用注释；报告用表格、简洁中文。

## 飞牛音乐（fnOS trim.music）
- 网关 `/music/api/v1`，信封 `{code,msg,data}`；登录 `POST /user/password-login`（密码 SHA-256 hex、deviceId 32 位 hex）；会话 `Authorization: <userToken>`（无 Bearer）。
- 媒体接口（`/static/cover`、`/track/stream`）只认 Authorization 头；FN Connect 中继（`*.fnos.net`/`*.5ddd.com`）必须 `Cookie: mode=relay`，适配器 `buildHeaders()` 自带。
- RN 的 `URL` 是存根 → 纯字符串解析；RN 设 Cookie 头必须 `credentials:'omit'`。
- `useFnosAdapter` 改名导入 `as activateFnosAdapter` 规避 hooks 误报。
- 飞牛强制 MUSIC、不能注册、无搜索历史；列表无 lyrics，仅 `GET /lyric/list?trackGUID=` 懒加载并回 currentTrack。文档 `docs/fnos-music-api.md`。
- 各端媒体：desktop web→`/__fnos` 代理；Tauri→`src-tauri/src/fnos_media.rs` 回环；mobile→组件带 headers；hm→落盘/AVPlayer 带 headers。
- mini 暂不接入（2026-11-11）：媒体要 header，小程序无 header 能力。重启条件：服务端媒体代理或 `wx.downloadFile` 真机验证。

## deviceId
- `computeDeviceId`（`packages/ws/src/deviceId.ts`）= md5(clientType␟osName␟osVersion␟brand␟manufacturer␟model␟deviceName) 前 12 位 + 端前缀，五端同步；禁随机 ID。
- 持久化 key `audiodock_device_id`（mobile 带 `@`）。

## 设备与流转（2026-11-16）
- 多端必须连同一服务端（同一 dev.db），否则设备互不可见。
- vite dev 必须代理 `/socket.io`（ws:true），proxy target 用 `127.0.0.1`；socket.io-client 把 path 当 namespace → `normalizeSocketUrl()` 剥路径；按 url|token|userId|deviceId signature 判断重连。
- mobile socket 用 HTTP `getBaseURL()`，AppState 回前台重连；`setDeviceOffline` name 兜底带 platform。
- 目标离线服务端暂存流转 10min 补投；端侧兜底 REST `POST /user/devices/transfer`；ack 三态 sent/failed/timeout 不重发。
- 生效顺序：ws build → api 重启 → vite 重启 → 各端重连同地址。

## harmony（ArkTS）
- 构建：`DEVECO_SDK_HOME=<DevEco>/Contents/sdk`，`env -u NODE_OPTIONS`，`cd apps/harmony && hvigorw --mode module -p product=default -p module=entry@default assembleHap --no-daemon`；构建后跑 `scripts/harmony-cleanup.sh`。
- 禁对象 spread/`as const`/indexed access；FontWeight 六种；@Builder 无 const/if；8 位 hex=`#AARRGGBB`；悬浮用 Stack 兄弟层 + hitTestBehavior(None)。
- LRCParser.time 是**毫秒**（mobile 是秒）。
- 小部件：preferences `audiodock_kv` 用 getFresh/getJSONFresh；卡片只认 data: URI，>80KB 封面压缩（ImageKit→packToData JPEG q78）；播控必须 call 事件。
- VIP：EntryAbility 恢复 `plus_token`→`setPlusAuthToken`；判定用 `plusApi.getMe → vipTier !== 'NONE'`。
- AVSession：首次真播放才 activate；事件 play/pause/playNext/playPrevious/seek/setSpeed。
- mobile `VinylCover.tsx`：Reanimated worklet 禁递归引用；无限循环 `withRepeat(...,-1,false)`。

## desktop
- 严禁模块顶层调 hook；backdrop-filter 毁 position:fixed；外链一律 `tauriOpenExternal`（shell open() 无声失败）。
- 版本更新走 `GET /download/latest?product=audiodock`；MinIO 预签名 5 分钟，点下载时重拉。
- Tauri/Windows：创建新 webview 窗口的 command 必须 async（同步死锁白屏）；任务栏缩略图 `src-tauri/src/taskbar_thumb.rs`。

## mobile 播放状态
- AsyncStorage 6MB 上限 → savePlaybackState 瘦身 + 队列窗口 ±50，否则冷启动 mini 播放器不展示。
- 恢复路径绝不出声：`suppressAutoResumeRef` 初始 true；contentMode 竞态要 modeLoaded 闸门。
- CarPlay：react-native-carplay@2.4.1-beta.0 裸 RN 集成；JS `src/services/carplay.ts` + `carplayBridge.ts`。

## 跨端
- 横屏封面轮播（hm+mobile）：堆叠靠渲染顺序不靠 zIndex；effPos = idx − posAnim。
- 四端缓冲进度条：Slider 底轨透明 + 下叠自绘层。
- 版本更新弹窗：`classifyRelease(body, platform)`（conventional commit scope 过滤），三端别名表同步。
- 歌词手动滚动（2026-11-14）：拖动接管→中心行时间戳+播放键→点击 seek 恢复→2s 未操作显式回弹。mobile `LyricsScrollArea.tsx`（半屏留白放容器自身）；desktop `Player/Lyrics.tsx`（autoScrollingRef + scrollend）；mini `pages/player/index.tsx`（scrollIntoView 先清空再设回）；hm `PlayerPage.ets`（onScrollIndex center 需 ref 屏蔽、轻点≠拖动 Down 只记起点 Move 超阈值才接管）。
- mini→全屏封面/主题色预热（2026-11-16）：mobile `PlayerProvider` + `utils/playerVisualPrefetch.ts`；hm `PlayerStore.notify()` + `utils/coverCache.ets`（ArkUI Image 与 http 不共享缓存须落盘）；预热失败即清缓存。desktop 天然无问题。mini 用 `utils/coverPrefetch.ts`（预取与渲染 URL 必须同一构造函数）。

## services/mi 小爱音箱
- sqlite3 走 asyncio.to_thread，API 前缀 /api，docker 挂 auth.json/.mi.token/data/。
