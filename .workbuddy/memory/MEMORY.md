# AudioDock 项目长期记忆

> 精简版（2026-11-16 重写，合并去重）。细节查 `docs/` 与每日日志。

## 通用约定
- 远程 `git@github.com:NasDock/AudioDock.git`；`.workbuddy/memory/` 随代码提交。
- 本机 bash `grep` 静默无输出 → 一律用 Grep 工具；`eslint .` 多目录撞 broker socket EPIPE（分目录跑）。
- @soundx/services father 构建入口指 `dist`，改 `src/` 必须 `cd packages/services && pnpm build`。
- 用户偏好：注释式 soft-disable 下线功能；结构化中文报告 + 多文件改动表格。

## 设备与流转
- deviceId 必须确定性：`computeDeviceId`（md5 七字段前 12 位 + 端前缀，`packages/ws/src/deviceId.ts`），五端同步；禁随机 ID（曾致 device_offline）。持久化 key `audiodock_device_id`（mobile 带 `@`）。
- transfer_session：emit {targetDeviceId, currentTrack, playlist:{list,index}, progress秒} 等 ack 5s；REST `POST /user/devices/transfer`；服务端支持 targetDeviceName/targetPlatform 兜底；`markAllDevicesOffline` 清脏数据。hm `webSocket.connect` 第二参必须 `{}`；desktop web 生产 WS URL 必须绝对路径。
- **多端必须连同一台服务端**（历史：web/hm 连 NAS `192.168.1.6:8865`，本机 3000 是另一套 dev.db → 设备互不可见、流转必失败）。排查先只读查 Device 表 `isOnline/lastSeen`，再用 socket.io-client 直连模拟两设备验证服务端，别先改服务端。
- **WS 注册链路（2026-11-16 修）**：desktop dev 的 vite 必须代理 `/socket.io`（`ws:true`），只代理 `/api` → dev 模式 WS 全断；proxy target 用 `127.0.0.1` 不用 `localhost`（macOS 优先 ::1，后端只听 IPv4 → 502）。socket.io-client 会把 URL path 当 **namespace** → `normalizeSocketUrl()` 剥路径（RN URL 是存根，纯字符串解析）；业务参数 query + auth 双通道；按 `url|token|userId|deviceId` signature 判断是否重连，参数未变绝不重建 socket。
- mobile socket 必须用 HTTP 的 `getBaseURL()`（autoSwitchServer 会切内外网），不能读 AsyncStorage 原文；AppState 回前台重连（Android 后台冻结定时器）。`setDeviceOffline` 的 name 兜底必须带 platform（与 saveDevice 一致），否则同名不同端互挤下线。
- 目标 WS 离线时服务端**暂存流转 10min**（内存 Map）→ 回 `transfer_sent(queued:true)`，设备上线补投（deviceId 漂移按 name+platform 兜底）；端侧 WS 未连/明确失败走 REST `transferSession()` 兜底，ack 超时不重发（防重复起播）。改 `packages/ws/src` 后**必须 `pnpm build`**（入口是 dist）。

## 飞牛音乐（fnOS trim.music，docs/fnos-music-api.md）
- 网关 `/music/api/v1`，信封 `{code,msg,data}`；登录 `POST /user/password-login`（密码 SHA-256 hex、deviceId 32 位 hex）；会话 `Authorization: <userToken>`（无 Bearer）。
- 媒体接口（`/static/cover`、`/track/stream`）只认 Authorization 头，query token/Cookie 全 401；FN Connect 中继（`*.fnos.net`/`*.5ddd.com`）必须 `Cookie: mode=relay` 否则 302，适配器 `buildHeaders()` 自带。
- RN 全局 `URL` 是存根（只有 getter）→ `resolveFnosServer()` 已改纯字符串解析；RN 手动设 Cookie 必须关 credentials（fetch `credentials:'omit'` / axios `withCredentials:false`），否则 OkHttp jar 覆盖 → 302。
- 切换函数名 `useXxxAdapter` 触发 rules-of-hooks 误报 → 统一别名 `activateFnosAdapter`。
- 只有音乐（强制 MUSIC）、不能注册/扫码、无搜索历史；列表无 lyrics，仅 `GET /lyric/list?trackGUID=`，切歌懒加载并回 currentTrack。
- 媒体方案：desktop web→dev server `/__fnos` 代理；desktop Tauri→`src-tauri/src/fnos_media.rs`（`/fnos/{*rel}?__b=<origin>`，服务端补 Cookie + Range）；mobile→组件带 headers；hm→端侧下载落盘 / AVPlayer 带 headers。
- mini 暂不接入（2026-11-11）：`<image src>` / `BackgroundAudioManager.src` 无 header 能力、不能开回环代理。重启条件：服务端通用媒体代理 / `wx.downloadFile` 真机验证。将来注意：mini `sourceUtils.ts` 独立 SOURCEMAP；axios 不可用需注入 `setFnosTransport(Taro.request)`；sha256 依赖 TextEncoder polyfill；`buildTrackPlaybackUrl` 异 host 改写需特判；域名白名单。

## HarmonyOS
- 构建：`DEVECO_SDK_HOME=<DevEco>/Contents/sdk`、DevEco 自带 node、`env -u NODE_OPTIONS`；`cd apps/harmony && hvigorw --mode module -p product=default -p module=entry@default assembleHap --no-daemon`；API 24；报 00303217 先 `--stop-daemon`；构建后跑 `scripts/harmony-cleanup.sh`。
- ArkTS 坑：禁对象 spread/`as const`/indexed access；FontWeight 仅六种；@Builder 内无 const/if；8 位 hex `#AARRGGBB`；每组件一个 bindSheet（宽屏居中 `SheetType.CENTER`）；HitTestMode.None 只禁自身，不响应+不挡下层用 Visibility.Hidden；判别联合失败分支显式 `as ValidationErr`；@Prop 禁与组件属性同名（size→discSize）；AnimateParam.onFinish 存在；ForEach 动态属性读 @State 现场算。
- 小部件（docs/harmony-widget.md）：EntryFormAbility 1管4 + WidgetBridge + WidgetCommandHandler；preferences `audiodock_kv`，onAddForm 用 `formInfo.IDENTITY_KEY`；跨进程读走 getFresh/getJSONFresh、subscribe 无效 → PlayerStore.notify() 加 pushToWidget 节流 1000ms；播控用 call 事件；冷启动 `playerStore.restoreState()`；卡片只认 data: URI（>80KB 封面先压缩，ImageKit desiredSize→packToData JPEG q78，300px/96px）；`packing()` 废弃用 `packToData()`。
- VIP 锁定（2026-11-08）：EntryAbility.initialize 必须恢复 plus_token→setPlusAuthToken；判定用 `plusApi.getMe → vipTier !== 'NONE'`（`/vip/status` 语义不同）；登录/支付/退出主动 syncVip/clearVipSnapshot。
- 沉浸式状态栏：setWindowLayoutFullScreen(true) + getWindowAvoidArea 换 vp 存 AppStorage + avoidAreaChange 监听；每个 @Entry 根容器 @StorageProp padding。
- AVSession：createAVSession+activate、setAVMetadata+setAVPlaybackState、prepare 前 STREAM_USAGE_MUSIC；首次真播放才 activate；事件 'play'/'pause'/'playNext'/'playPrevious'/'seek'/'setSpeed'。
- 飞牛源：`features/network/src/main/ets/fnos/`；分发靠模块级开关 enableFnos()；封面 `utils/fnosCover.ets` 落盘、音频 `media.createMediaSourceWithUrl(url, headers)`；跳过缓存/预下载；WidgetBridge.downloadBytes 补 headers。
- 主题插件：schema/store 在 products/entry/.../theme/（JSON 与 mobile 通用，key `soundx-player-themes`）；VinylCover.ets interval 旋转。mobile VinylCover.tsx —— Reanimated worklet 禁递归引用（UI 线程 undefined → 无错误边界闪退，2026-11-02）；无限循环用 `withRepeat(...,-1,false)`，启动前 value %360。

## desktop
- 严禁模块顶层调 React hook；token 在组件函数体内取。
- 打开外链一律 `tauriOpenExternal`（`invoke('open_url')` → tauri-plugin-opener）；`@tauri-apps/plugin-shell` 的 open() 无声失败（未注册 plugin-shell）。
- 版本更新 `GET /download/latest?product=audiodock`（`src/services/update.ts`），files[].platform 枚举；GitHub Release 只取 changelog；MinIO 预签名 5 分钟 → 点击时重拉再打开。
- backdrop-filter 毁 position:fixed（浮层移出容器）；LazyImage 内联 width/height 盖 less 类 → 传数字 px；封面自适应 `hooks/useAdaptiveCoverSize.ts`（ResizeObserver）；CarMode 容器已含媒体栏压缩。
- Tauri/Windows：创建新 webview 窗口的 command 必须 async（同步 command 在 WebView2 IPC 线程 build() 死锁 → 新窗口白屏 `Chrome_WidgetWin_0` 恒 0x0 + 主窗口失效）；窗口已存在 show+focus 复用；transparent 仅 macOS；mini 窗口 transparent(true)+shadow(false)；白屏定位用 EnumWindows + `%APPDATA%/cn.audiodock.desktop` 日志探针；任务栏缩略图 `src-tauri/src/taskbar_thumb.rs`（DwmSetIconicThumbnail + ITaskbarList3，THBN_CLICKED=0x1800，Win32/COM 收敛窗口线程）。

## mobile
- AsyncStorage Android 上限 6MB：savePlaybackState 必须瘦身（剥 lyrics/嵌套数组、队列 ±50 窗口），失败降级单曲最小状态；否则 `playbackState_MUSIC` 缺失 → 冷启动 mini 播放器不展示。
- 恢复路径绝不出声：`suppressAutoResumeRef` 初始 true，仅 playTrack/playTrackList/resume 清除；contentMode 竞态用 playMode.tsx 的 `modeLoaded` 闸门。
- CarPlay（iOS，2026-11-01）：root CPListTemplate + 系统 CPNowPlayingTemplate；播控走 RNTP MPRemoteCommandCenter；react-native-carplay@2.4.1-beta.0 裸 RN 集成（Expo 不支持）；PhoneSceneDelegate 建 window + startReactNative，AppDelegate 只留 factory；CarSceneDelegate 转发 connect/disconnect；pbxproj 手工注入四处；JS `src/services/carplay.ts` + `carplayBridge.ts`。真机冷启动待验证。
- 歌词滚动（2026-11-14）：统一 `components/LyricsScrollArea.tsx`；`app/player.tsx` 只留 parseLyrics + parsedLyrics + renderLyricsArea。半屏留白放行容器自身（放 contentContainerStyle 会让 onLayout.y 少 H/2）；手动拖动接管（interactingRef 闸门）；onScrollEndDrag/MomentumEnd 起 2s，超时显式 scrollTo（暂停也生效）；中心行左时间右播放按钮 → seekTo + resume；自动跟随节流键 `trackId|index|fontSize|round(H)`；行 y 重排 rAF 合并。

## 其它跨端
- 横屏封面轮播（hm+mobile）：横屏 && 高<500 && queue>1；锚点 1:2:3（66.7/133.3/200）；effPos=idx−posAnim 单值；堆叠靠渲染顺序（Android zIndex 无效）→ entries 按 |basePos| 降序；窗口 ±3；封面 ≤300 档 + prefetch ±3。
- 四端缓冲进度条：desktop audio.buffered / mobile useProgress().buffered / hm bufferingUpdate / mini BackgroundAudioManager.buffered；Slider 底轨透明 + 下叠自绘缓存层。遗留：desktop Tauri MiniPlayer 进度不走 currentTime IPC。
- 版本更新弹窗平台过滤（2026-10-26）：release body conventional commit scope 标端（无 scope=全端）；各端 `classifyRelease(body, platform)`；别名表三端同步。desktop/mobile `hooks/useCheckUpdate.ts`，hm `services/updateService.ets`（ArkTS 禁 Record 索引）。
- 歌词四端统一语义（2026-11-14）：手动拖动接管 → 中心行左时间右播放 → 点击 seek+恢复 → 2s 显式回弹。desktop `components/Player/Lyrics.tsx` DOM onScroll + getBoundingClientRect，scrollend 监听 effect 依赖带 `parsedLyrics.length`；mini `pages/player/index.tsx` scrollIntoView 先清空再 30ms 设回 + `scrollIntoViewAlignment='center'`，无命令式 scrollTo 用 createSelectorQuery 实测，操作条拆小块别全宽覆盖；hm `PlayerPage.ets` + `EmbeddedPlayerPanel.ets` 用 List.onScrollIndex center（程序化滚动需 ref 屏蔽），onTouch(Down) 接管、onScrollStop 2s，**LRCParser.time 毫秒**（mobile 秒）seek 别 ×1000，接管状态独立 @State，Stack 兄弟层 + hitTestBehavior(None)。三端 tsc/build 通过，均未真机验证。
- mini 会员支付：plusWechatMpSession→openid；下单 clientType:'miniprogram'+openId；wechatPay 喂 Taro.requestPayment。
- services/mi 小爱音箱：sqlite3 `data/xiaoai.db` 走 asyncio.to_thread；唤醒词 DB 优先；API 前缀 /api；docker 挂 auth.json/.mi.token/data/。
- CI：Android job 不用 android-actions/setup-android@v3，ubuntu-latest 自带 SDK。
