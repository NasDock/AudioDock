# AudioDock 项目长期记忆

> 精简版（2026-11-15 重写，合并去重）。细节查 `docs/` 与每日日志。

## 仓库与协作约定
- 远程 `git@github.com:NasDock/AudioDock.git`（旧 mmdctjj 重定向），分支 `feat/test`；`.workbuddy/memory/` 日志随代码一起提交。
- 本机 bash `grep` 静默无输出 → 检索一律用 Grep 工具；`eslint .` 多目录撞 broker socket EPIPE（分目录跑）。
- @soundx/services 构建入口指 `dist`，改 `src/` 必须 `cd packages/services && pnpm build`。
- 用户偏好：代码先于 UI（新增接口先落 service/model 类型）；soft-disable 用注释而非硬删；报告用表格、简洁中文。

## 飞牛音乐（fnOS trim.music）
- 网关 `/music/api/v1`，信封 `{code,msg,data}`，code 0；登录 `POST /user/password-login`（密码 SHA-256 hex、deviceId 32 位 hex）；会话 `Authorization: <userToken>`（**无 Bearer**）。
- **媒体接口（`/static/cover`、`/track/stream`）只认 Authorization 头**（query token / Cookie 全 401）；**FN Connect 中继（`*.fnos.net`/`*.5ddd.com`）必须 `Cookie: mode=relay`**，否则 302 到登录页。适配器 `buildHeaders()` 自带。
- RN 全局 `URL` 是存根（只有 getter）→ `resolveFnosServer()` 用纯字符串解析；RN 设 Cookie 头必须 `credentials:'omit'` / `withCredentials:false`，否则 OkHttp 用 jar 覆盖手动头。
- 适配器切换 `useXxxAdapter` 触发 rules-of-hooks 误报 → `import { useFnosAdapter as activateFnosAdapter }`。
- 飞牛只有音乐（强制 MUSIC）、不能注册/扫码登录、无搜索历史（端侧存储顶替）；**列表不返回 lyrics**，只有 `GET /lyric/list?trackGUID=`，切歌懒加载并**并回 currentTrack**。文档 `docs/fnos-music-api.md`。
- 各端媒体：desktop web→dev server `/__fnos` 代理；Tauri→本地回环 `src-tauri/src/fnos_media.rs`（`/fnos/{*rel}?__b=<origin>`，按 origin 补 Cookie + Range 透传）；mobile→组件带 headers；hm→端侧下载落盘 / AVPlayer 带 headers。
- **mini 暂不接入**（2026-11-11）：媒体要 header，但 `<image src>` / BackgroundAudioManager 无 header 能力且不能开本地回环；为单源引入「唯一走服务端」不一致。重启条件：服务端通用媒体代理 / `wx.downloadFile` 落盘真机验证。将来做注意：`sourceUtils.ts` 是本地独立 SOURCEMAP；axios 不可用须 `setFnosTransport(Taro.request)`；sha256 依赖 TextEncoder polyfill；`buildTrackPlaybackUrl` 会改写异 host 绝对 path；微信域名白名单。

## deviceId
- 必须确定性：`computeDeviceId` = md5(clientType␟osName␟osVersion␟brand␟manufacturer␟model␟deviceName) 前 12 位 + 端前缀（`packages/ws/src/deviceId.ts`），五端同步；禁 `xxx_${Date.now()}` 随机 ID（device_offline 根因）。
- 持久化 key `audiodock_device_id`（mobile 带 `@`）；desktop async `computeStableDeviceId`，hm cryptoFramework MD5 + deviceInfo。

## harmony 构建与 ArkTS 坑
- `DEVECO_SDK_HOME=<DevEco>/Contents/sdk`，node 用 DevEco 自带，必须 `env -u NODE_OPTIONS`；`cd apps/harmony && hvigorw --mode module -p product=default -p module=entry@default assembleHap --no-daemon`（Bash cwd 不跨命令）；SDK API 24，报 00303217 先 `--stop-daemon`；构建后跑 `scripts/harmony-cleanup.sh` 再提交。
- 禁对象 spread / `as const` / indexed access；FontWeight 仅六种；@Builder 内无 const/if；8 位 hex = `#AARRGGBB`；判别联合失败分支显式 `as ValidationErr`；@Prop 命名禁与组件属性方法同名；ForEach 动态属性读 @State 现场算；AnimateParam.onFinish 存在；悬浮用 Stack 兄弟层。
- 触摸：HitTestMode.None 只禁自身、Block 阻断下层；「不响应+不挡下层」用 Visibility.Hidden；覆盖层须显式 `hitTestBehavior(None)`；每组件只能一个 bindSheet，宽屏居中 `preferType: SheetType.CENTER`。
- **LRCParser.time 是毫秒**（mobile 是秒）：hm `playerStore.seek(line.time)` 别再 ×1000，显示才 /1000。
- 小部件（docs/harmony-widget.md）：EntryFormAbility 1管4 + WidgetBridge；onAddForm key 用 `formInfo.IDENTITY_KEY`；preferences 跨进程读 getFresh/getJSONFresh + `PlayerStore.notify()` pushToWidget（节流 1s）；播控必须用 call 事件；**卡片只认 data: URI** → >80KB 封面先压缩（ImageKit desiredSize→packToData JPEG q78）。
- VIP 锁定：plus token 是 features_network 模块级变量，EntryAbility 必须恢复 `plus_token`→`setPlusAuthToken`；VIP 判定用 `plusApi.getMe → vipTier !== 'NONE'`（`/vip/status` 语义不同）。
- 沉浸式状态栏：setWindowLayoutFullScreen(true) + avoidArea→vp 存 AppStorage，每个 @Entry 根容器 @StorageProp padding；AVSession：首次真播放才 activate、prepare 前设 STREAM_USAGE_MUSIC，事件 'play'/'pause'/'playNext'/'playPrevious'/'seek'/'setSpeed'。
- 飞牛源：`features/network/src/main/ets/fnos/`，靠 `enableFnos()` 模块开关 + api/*.ets 入口 `if (isFnosSource())`；封面 `utils/fnosCover.ets` 下载落盘、音频 `media.createMediaSourceWithUrl(url, headers)`；fnos 源跳过缓存/预下载；缺口：专辑收藏/历史空实现、无上传、音质只 lossless。
- 主题插件：schema/store 在 `products/entry/src/main/ets/theme/`（JSON 与 mobile 通用，key `soundx-player-themes`）；VinylCover.ets interval 旋转暂停停表不清角。mobile 的 `VinylCover.tsx` —— **Reanimated worklet 禁递归引用自身/同组件其他 worklet**（序列化到 UI 线程为 undefined → 闪退且无 JS 错误边界）；无限循环 `withRepeat(..., -1, false)`，启动前 %360。

## desktop
- 严禁模块顶层调 React hook；token 在组件函数体内取。backdrop-filter 毁 position:fixed → 浮层移出容器。LazyImage 内联 width/height 盖掉 less 类 → 传数字 px。封面自适应统一 `hooks/useAdaptiveCoverSize.ts`。
- **打开外链一律 `tauriOpenExternal`**（`invoke('open_url')` → tauri-plugin-opener）；`@tauri-apps/plugin-shell` 的 `open()` 必无声失败。
- 版本更新走后端 `GET /download/latest?product=audiodock`（`src/services/update.ts`），GitHub Release 只取 changelog；直链是 MinIO 预签名 5 分钟 → 点下载时重新拉一次。
- Tauri/Windows：**创建新 webview 窗口的 command 必须 async**（同步 command 在 WebView2 IPC 线程死锁 → 新窗白屏 0x0 + 主窗点击失效）；已存在窗口 show+focus 复用；transparent 仅 macOS 需要，Windows 覆盖 false；白屏定位用 EnumWindows + 日志探针；任务栏缩略图 `src-tauri/src/taskbar_thumb.rs`（DwmSetIconicThumbnail + ITaskbarList3，THBN_CLICKED=0x1800，Win32/COM 收敛窗口线程）。

## mobile 播放状态与冷启动
- AsyncStorage 有 6MB 上限 → savePlaybackState 必须瘦身（剥 lyrics/嵌套数组，仅当前曲留歌词）+ 队列窗口 ±50，失败降级存单曲；否则写入永远失败 → `playbackState_MUSIC` 缺失 → 冷启动 mini 播放器不展示。
- 恢复路径绝不出声：`suppressAutoResumeRef` 初始 true，只有 playTrack / playTrackList / resume 清除；contentMode 竞态要 `modeLoaded` 闸门。
- CarPlay：根 CPListTemplate + 系统 CPNowPlayingTemplate，播控走 RNTP 的 MPRemoteCommandCenter；react-native-carplay@2.4.1-beta.0（Expo 需裸 RN 集成），PhoneSceneDelegate 建 window + startReactNative，CarSceneDelegate 转发 connect/disconnect，新文件手工注入 pbxproj 四处。真机冷启动待验证。

## 跨端
- 横屏封面轮播（hm+mobile）：横屏 && 高<500 && queue>1；锚点 1:2:3；effPos = idx − posAnim 单动画值；**堆叠靠渲染顺序不靠 zIndex**（Android transform 兄弟 z 排序失效）；窗口 ±3；封面 ≤300 档 + prefetch 前后 3 首。
- 播放流转 transfer_session：emit {targetDeviceId, currentTrack, playlist:{list,index}, progress秒} 等 ack 5s；REST `POST /user/devices/transfer`；hm `webSocket.connect` 第二参必须 `{}`；desktop web 生产 WS URL 必须绝对路径。
- 四端缓冲进度条：desktop audio.buffered / mobile useProgress().buffered / hm bufferingUpdate / mini BackgroundAudioManager.buffered；Slider 底轨透明 + 下叠自绘层。遗留：desktop Tauri MiniPlayer 进度不走 currentTime IPC。
- 版本更新弹窗平台过滤：release body 用 conventional commit scope（无 scope=全端），各端 `classifyRelease(body, platform)`，别名表三端同步；hm `services/updateService.ets`（ArkTS 禁 Record 索引用 if/else）。
- mini 会员支付：plusWechatMpSession→openid，下单 clientType:'miniprogram'+openId，wechatPay 喂 Taro.requestPayment。services/mi 小爱音箱：sqlite3 走 asyncio.to_thread，API 前缀 /api。CI Android job 不装 setup-android（ubuntu-latest 自带 SDK）。

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
