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

## 四端歌词手动滚动交互（2026-11-14 起）
- 统一语义：手动拖动接管（自动跟随让位）→ 中心行左侧时间戳 + 右侧播放按钮 → 点击 seek 并恢复播放 → 2s 未点**显式** scroll 回弹（暂停也生效，不依赖进度变化）。
- **mobile**：`src/components/LyricsScrollArea.tsx` 统一竖屏/横屏/车机分栏；`onScrollBeginDrag` 接管、`onScrollEndDrag`/`onMomentumScrollEnd` 起 2s；**半屏留白必须放行容器自身**（放 contentContainerStyle 会让行 `onLayout.y` 少 H/2 → 中心行与回弹错半屏）；自动跟随节流键 `trackId|index|fontSize|round(H)`，行 y 重排用 rAF 合并；操作条 absoluteFill 居中 + maxWidth 560。
- **desktop**：`components/Player/Lyrics.tsx` DOM `onScroll` 接管 + `getBoundingClientRect` 实测中心行；`autoScrollingRef` + `scrollend` 区分程序化滚动（监听 effect 依赖必须带 `parsedLyrics.length`）；`CarMode` 父层 `cycleMergedView` 接管期间 stopPropagation；`onSeekPlay` 由 Player/CarMode 注入。独立歌词窗口/MiniPlayer 只有单行歌词，未改。
- **mini**：`pages/player/index.tsx` `scrollIntoView` 同值不触发（先清空再 30ms 设回）+ 对齐 center；无 onLayout/命令式 scrollTo → `createSelectorQuery` 实测 + rpx 估算兜底；操作条拆成独立绝对定位小块（全宽覆盖层会挡滚动）；退出歌词用 `lyricSeekPlayAt` 时间戳兜底。
- **hm**：`PlayerPage.ets`（竖/横屏共用）+ `EmbeddedPlayerPanel.ets`（车机 9:16）；`List.onScrollIndex` 的 center 定位中心行（程序化滚动也会回调，需 ref 屏蔽）；`onScrollStop` 起 2s、subscribe 自动跟随加 `!lyricInteractingRef` 闸门；接管状态必须独立 @State（view 是快照）；Stack 兄弟层 + hitTestBehavior(None)。AVSession 桌面歌词/小部件不适用。
- **轻点 != 拖动**：hm 的 `onTouch(Down)` 不能立刻接管，否则轻点歌词会弹时间条且被 `lyricInteractingRef` 挡住切回封面。Down 只记起点，`Move` 位移超阈值才接管；拖动抬起用时间戳挡住误触 click；轻点始终切封面并清 timer。
- 验证：desktop tsc + vite build、mini build:weapp、hm assembleHap BUILD SUCCESSFUL；四端均未真机验证。

## mini→全屏 封面/主题色预热（2026-11-16，四端结论）
- 只有 mobile/hm 有完整问题：取色原先**只在全屏页挂载**触发 → mini 态缓存空、首帧中性黑；且 mini 96 档 / 全屏 900(hm 600)+300 档 URL 不同 → 重下大图。已改为全局层预热：mobile `PlayerProvider` + `utils/playerVisualPrefetch.ts`（主题色立即、大图延迟 3s `Image.prefetch`）；hm `PlayerStore.notify()` + 新增 `utils/coverCache.ets`（ArkUI Image 与 http 下载**不共享缓存**，必须落盘 `file://` 再同步读，路径与 `fnosCover` 共用）。两端都要「预热失败即清缓存」，否则 null 被永久缓存会比闪一下更糟。
- **desktop 本来就没问题**：`Player` 常驻在 `App.tsx` Routes 之外（`useCoverDominantColor` 在组件顶层）→ 切歌即取色，等于天然全局预热；取色/模糊背景/底部条都是 300 档同一 URL；Tauri `mini` 是独立 WebviewWindow 且根本不画主题色背景。旁支隐患：`img.onerror` 会 `cache.set(src,null)` 永久缓存失败。
- **mini 只有「大图重下」半个问题**：mini 端**无取色/主题色渐变**，全屏背景恒 `#fff`（mini 条同色）→ 不会背景色跳变；但 mini 128 档 / player 600 档 URL 不同，微信 `<image>` 按 URL 缓存不命中 → `#eee` 灰底闪。已修：新增 `utils/coverPrefetch.ts`（唯一 URL 出口 `buildPlayerCoverUrl`、本地 path Map + inflight、同步 `resolvePlayerCoverSrc`），`MiniPlayer` 闲时 1.5s 挂 2rpx 隐藏 `<image>` 拉进微信缓存 + 试 `Taro.getImageInfo` 拿本地路径；player 页首帧同步读。
- 小程序特有：无 RN `Image.prefetch`；隐藏 `<image>` 不需 downloadFile 合法域名，`getImageInfo` 需要（真机 https，内网 http 会失败 → 静默降级）；外链封面 `getImageUrl` 直返原 URL、与 width 无关，跳过预取；`/image/optimize` 是 `@Public()` 免鉴权；mini 未接入飞牛源。
- 预取 URL 与渲染 URL **必须同一个构造函数**，否则客户端缓存必不命中；desktop Tauri 回环端口每次启动随机，别把绝对 URL 落盘/持久化。
## mobile 播放状态持久化与冷启动（2026-11-08）
- **AsyncStorage 有容量上限**（Android 默认 6MB）：不可整列持久化原始 Track（含 lyrics + likedByUsers/playlists 嵌套数组）→ 音乐队列常是整个曲库，写入永远失败且 catch 只打日志 → `playbackState_MUSIC` 缺失 → 冷启动 mini 播放器不展示。savePlaybackState 必须瘦身（剥 lyrics/嵌套数组，仅当前曲保留歌词）+ 队列窗口裁剪（当前曲前后各 50 首），失败再降级存单曲最小状态。
- **恢复路径绝不出声**：`suppressAutoResumeRef`（初始 true），loadPlaybackState 入口置 true；只有 playTrack / playTrackList / resume 三个显式入口清除。冷启动 userPausedRef 默认 false 会误触发兜底 TrackPlayer.play()。
- **contentMode 异步竞态**：playMode.tsx 暴露 `modeLoaded`，PlayerContext 初始恢复 effect 必须加 `!modeLoaded` 闸门，否则 MUSIC/AUDIOBOOK 两次 setQueue 交错。
- 恢复队列被窗口化（±50 首），非当前曲目无歌词，需用户手动点播放（产品预期）。

## 其它跨端
- **横屏封面轮播**（hm+mobile）：判定 横屏 && 高<500 && queue>1；锚点 1:2:3（66.7/133.3/200），非当前露 1/3；effPos = idx − posAnim（单动画值）；**堆叠靠渲染顺序不靠 zIndex**（Android transform 兄弟 z 排序不生效）→ entries 按 |basePos| 降序；单 Animated.Value 驱动防闪烁；窗口 ±3 缓冲；列表/轮播封面 ≤300 档 + prefetch 前后各 3 首。
- **播放流转 transfer_session**：emit {targetDeviceId, currentTrack, playlist:{list,index}, progress秒} 等 ack（5s）；REST 版 POST /user/devices/transfer。服务端支持 targetDeviceName/targetPlatform 兜底；markAllDevicesOffline 清脏数据。hm webSocket.connect 第二参必须传 `{}`。desktop web 生产 WS URL 必须绝对路径。
- **四端缓冲进度条**：desktop audio.buffered / mobile useProgress().buffered / hm bufferingUpdate / mini BackgroundAudioManager.buffered；Slider 自带底轨透明 + 下叠自绘缓存层。遗留：desktop Tauri MiniPlayer 小窗进度不走 currentTime IPC。
- **版本更新弹窗平台过滤**（2026-10-26）：release body 用 conventional commit scope 标目标端（无 scope=全端，`feat(mobile)`/`feat(api)`=单端）。各端 `classifyRelease(body, platform)`；scope 别名表改动需三端同步。实现：desktop/mobile `hooks/useCheckUpdate.ts`，hm `services/updateService.ets`（ArkTS 禁 Record 索引用 if/else）。
- **CarPlay**（mobile iOS，2026-11-01）：根 CPListTemplate + 系统 CPNowPlayingTemplate；播控走 RNTP 已注册的 MPRemoteCommandCenter。react-native-carplay@2.4.1-beta.0（官方不支持 Expo，ios/ 按裸 RN 集成）。原生双场景：PhoneSceneDelegate 建 window + startReactNative（AppDelegate 只留 factory，规避 CarPlay 冷启动崩溃）；CarSceneDelegate 转发 RNCarPlay.connect/disconnect；新文件手工注入 pbxproj（BuildFile/FileRef/Group/Sources 四处）。JS：src/services/carplay.ts + carplayBridge.ts。待验证：真机 CarPlay 冷启动路径。
- mini 会员支付：plusWechatMpSession→openid；下单 clientType:'miniprogram'+openId；返回 wechatPay 喂 Taro.requestPayment。
- services/mi 小爱音箱：sqlite3（data/xiaoai.db）操作走 asyncio.to_thread；唤醒词 DB 优先；API 前缀 /api；docker 挂 auth.json/.mi.token/data/。
- CI：Android job 不用 android-actions/setup-android@v3，ubuntu-latest 自带 SDK。
- 本机 bash `grep` 静默无输出（检索一律用 Grep 工具）；`eslint .` 多目录会撞 WorkBuddy broker socket EPIPE（分目录跑）。

## mobile 歌词滚动交互（2026-11-14，仅 mobile）
- 歌词渲染/滚动统一在 `apps/mobile/src/components/LyricsScrollArea.tsx`（横屏右栏 / 竖屏 / 车机分栏共用）；`app/player.tsx` 只留 `parseLyrics`（LyricsFontSizeModal 依赖）+ `parsedLyrics` useMemo + `renderLyricsArea()`。
- **上下半屏留白必须放在行容器自身**，不能放 `contentContainerStyle`：后者会让行 `onLayout.y` 少掉 H/2 偏移，中心行判定与回弹整体错半屏。
- 手动拖动 `onScrollBeginDrag` 接管（自动跟随 effect 用 `interactingRef` 闸门让位）；`onScrollEndDrag`/`onMomentumScrollEnd` 起 2s 倒计时，超时**显式 scrollTo 当前播放行**（暂停时 position 不变、effect 不跑，只能靠这条显式路径回弹）。中心行左侧时间 + 右侧播放按钮 → `seekTo(line.time)` + 未播放时 `resume()`。
- 自动跟随节流键 `trackId|index|fontSize|round(H)`；行 y 重排用 rAF 合并重新定位，避免锁死错误位置。操作条 `absoluteFill + 居中 + maxWidth 560 + 高度随字号` 自适应手机/Pad/横屏/分栏。

## 其余三端歌词交互（2026-11-14 已补齐）
- 四端统一语义：手动拖动接管（自动跟随让位）→ 中心行左时间 + 右播放按钮 → 点击 seek 并恢复播放 → 2s 未点**显式** scroll 回弹（暂停也生效，不依赖进度变化）。
- **desktop**：`components/Player/Lyrics.tsx` 用 DOM `onScroll` 统一接管 + `getBoundingClientRect` 实测中心行；`autoScrollingRef` + `scrollend` 区分程序化滚动（`scrollend` 监听 effect 依赖必须带 `parsedLyrics.length`，否则异步解析后容器才出现、空依赖注册不上）；`CarMode` 父层 `cycleMergedView` 要在接管期间 stopPropagation；`onSeekPlay` 由 Player（`handleSeek` + `play()`）/ CarMode（`seekBridge` + `play()`）注入。独立歌词窗口/MiniPlayer 只有单行歌词，未改。
- **mini**：`pages/player/index.tsx` 原地增强；`scrollIntoView` 同值不触发（先清空再 30ms 设回）+ `scrollIntoViewAlignment='center'`；**无 onLayout/命令式 scrollTo** → `createSelectorQuery` 实测行 y/height + rpx 估算兜底；操作条**不要全宽覆盖层**（小程序 pointer-events 会挡滚动），拆成独立绝对定位小块；父层退出歌词用 `lyricSeekPlayAt` 时间戳兜底。
- **hm**：`PlayerPage.ets`（竖/横屏共用 lyricsView）+ `EmbeddedPlayerPanel.ets`（车机 9:16）；`List.onScrollIndex` 的 `center` 直接给中心行（零测量，程序化滚动也会回调需 ref 屏蔽）；`onTouch(Down)` 接管、`onScrollStop` 起 2s、`subscribe` 自动跟随加 `!lyricInteractingRef` 闸门；**LRCParser.time 是毫秒**（mobile 是秒），`playerStore.seek(line.time)` 别再 ×1000，显示才 /1000；接管状态必须独立 @State（不能塞 `view` 快照）；`Stack` 兄弟层 + `hitTestBehavior(None)`。系统级 AVSession 桌面歌词/小部件不适用，未改。
- 验证：desktop `tsc -p tsconfig.app.json --noEmit` + `vite build` 通过；mini `npm run build:weapp` 通过；hm `hvigorw assembleHap` BUILD SUCCESSFUL（构建后跑 `scripts/harmony-cleanup.sh`）。三端均未真机验证。
## services/mi 小爱音箱
- sqlite3 走 asyncio.to_thread，API 前缀 /api，docker 挂 auth.json/.mi.token/data/。
