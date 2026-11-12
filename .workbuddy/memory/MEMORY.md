# AudioDock 项目长期记忆

> 精简版（2026-11-11 重写，合并去重）。细节查 `docs/` 与每日日志。

## 仓库与提交约定
- 远程：`git@github.com:NasDock/AudioDock.git`（旧 mmdctjj/AudioDock 重定向）。
- `.workbuddy/memory/` 工作日志随代码一起提交（用户确认 2026-11-01）。
- 本机 bash `grep` 静默无输出 → 检索一律用 Grep 工具；`eslint .` 多目录会撞 broker socket EPIPE（分目录跑）。
- @soundx/services：father 构建入口指 `dist`，改 `src/` 必须 `cd packages/services && pnpm build`。

## 飞牛音乐（fnOS trim.music）
- 协议：网关 `/music/api/v1`；信封 `{code,msg,data}`，code 0 成功；登录 `POST /user/password-login`（密码 SHA-256 hex、deviceId 32 位 hex）；会话用 `Authorization: <userToken>`（**无 Bearer 前缀**）。
- **媒体接口（`/static/cover`、`/track/stream`）只认 Authorization 头**：query token / Cookie music-token 实测全 401。
- **FN Connect 中继（`*.fnos.net`/`*.5ddd.com`）必须带 `Cookie: mode=relay`**，否则 302 到登录页。适配器 `buildHeaders()` 自带；端侧裸请求要手动补。
- **RN 全局 `URL` 是存根**（只有 getter）：`url.protocol=` 在严格模式抛 TypeError → `resolveFnosServer()` 已改纯字符串解析，别再写第二份 URL 解析。
- **RN 设 Cookie 头必须关 credentials**（fetch `credentials:'omit'` / axios `withCredentials:false`），否则 OkHttp 用 jar 的 cookie 覆盖手动头 → 中继 302。
- 适配器切换函数名 `useXxxAdapter` 触发 eslint rules-of-hooks 误报 → 统一 `import { useFnosAdapter as activateFnosAdapter }`。
- 飞牛只有音乐（强制 MUSIC）、不能注册、不能扫码登录、无搜索历史接口（`setSearchRecordStorage` 用端侧存储顶替）。
- **列表接口不返回 lyrics**，只有 `GET /lyric/list?trackGUID=`；切歌时懒加载并**并回 currentTrack**（播放页/车机/歌词预览共用）。
- 文档：`docs/fnos-music-api.md`（API 速查 + 各端链路差异 + 踩坑）。
- 各端媒体方案：desktop web→dev server `/__fnos` 代理；desktop Tauri→本地回环 `src-tauri/src/fnos_media.rs`（契约 `/fnos/{*rel}?__b=<origin>`，服务端按 origin 存会话补 Cookie + Range 透传）；mobile→组件带 headers；hm→端侧下载落盘 / AVPlayer 带 headers。

### mini（微信小程序）暂不接入飞牛（2026-11-11 决策）
- mini 的 Subsonic/Emby 都是**端侧直连第三方**（凭据塞 URL query：Subsonic `u/t/s`、Emby `api_key`），只有 AudioDock 官方源走自家服务端。
- 飞牛媒体只认请求头，而小程序 `<image src>`、`BackgroundAudioManager.src` **都没有 header 能力**（BackgroundAudioManager 无 header 属性，真机只播网络地址），也不能开本地回环代理 → 封面/音频无法裸 URL 直连。
- 业务层本可端侧直连，但为单个第三方源在 mini 引入「唯一走服务端」不一致 → **本次不做**。
- 重启条件：① AudioDock 服务端加通用媒体代理路由；② 端侧 `wx.downloadFile` 落盘在真机验证通过。
- 若将来要做，注意：mini 的 `sourceUtils.ts` 是**本地独立 SOURCEMAP**（公共常量覆盖不到）；**axios 在小程序不可用**（无 XHR/fetch）必须注入 `setFnosTransport(Taro.request)`；登录 sha256 依赖 `TextEncoder`（基础库<2.25 缺）需 polyfill；`buildTrackPlaybackUrl` 会把异 host 绝对 path 改写成自家 `/track/stream/<id>` 需特判；微信域名白名单要求。

## 设备标识（deviceId）
- 必须确定性：`computeDeviceId` = md5(clientType␟osName␟osVersion␟brand␟manufacturer␟model␟deviceName) 前 12 位 + 端前缀（`packages/ws/src/deviceId.ts`），五端同步。禁止 `xxx_${Date.now()}` 随机 ID（2026-09-21 流转 device_offline 根因）。
- 持久化 key 均 `audiodock_device_id`（mobile 带 `@` 前缀）。desktop 用 async `computeStableDeviceId`，hm 用 cryptoFramework MD5+deviceInfo。

## apps/harmony 构建
- `DEVECO_SDK_HOME=<DevEco>/Contents/sdk`，node 用 DevEco 自带，必须 `env -u NODE_OPTIONS`。
- `cd apps/harmony && hvigorw --mode module -p product=default -p module=entry@default assembleHap --no-daemon`（Bash 工具 cwd 不跨命令持久，必须同一条命令内 cd）。
- SDK API 24；报 00303217 先 `--stop-daemon`；构建后跑 `scripts/harmony-cleanup.sh` 清副作用再提交。

## ArkTS/ArkUI 高频坑
- 禁对象 spread/`as const`/indexed access；FontWeight 仅六种；@Builder 内无 const/if；8 位 hex=`#AARRGGBB`。
- 每组件只能绑一个 bindSheet；宽屏居中要 `preferType: SheetType.CENTER`。
- 触摸：HitTestMode.None 只禁自身，Block 阻断下层；「不响应+不挡下层」用 Visibility.Hidden；覆盖层须显式 hitTestBehavior(None)。
- 判别联合 `!result.ok` 收窄不可靠，失败分支显式 `as ValidationErr`；@Prop 命名禁与 CustomComponent 属性方法同名（size→discSize）。
- AnimateParam.onFinish 存在；悬浮用 Stack 兄弟层；ForEach 动态属性读 @State 现场算。

## hm 专题
- **小部件**（docs/harmony-widget.md）：EntryFormAbility 1管4 + WidgetBridge + WidgetCommandHandler；共享 preferences `audiodock_kv`。onAddForm key 用 formInfo.IDENTITY_KEY（误用 form_id → 卡片停首屏）。preferences 每进程一份缓存 → 跨进程读走 getFresh/getJSONFresh、subscribe 无效 → PlayerStore.notify() 加 pushToWidget 钩子（节流 1000ms）。播控必须用 call 事件；冷启动先 `playerStore.restoreState()`。**卡片只认 data: URI**（formrender 读不到主进程 file://）→ >80KB 封面先端侧压缩（ImageKit desiredSize→packToData JPEG q78，正在播放 300px/列表 96px）；`packing()` 自 API13 废弃用 `packToData()`。
- **VIP 锁定**（2026-11-08 修复）：① plus token 是 features_network 模块级变量，EntryAbility.initialize 必须恢复 plus_token→setPlusAuthToken，否则冷启动 syncVip 恒 401；② VIP 判定必须用 `plusApi.getMe → vipTier !== 'NONE'`（`/vip/status` 的 isVip 语义不同会误锁）；③ 登录/支付/退出主动调 widgetBridge.syncVip()/clearVipSnapshot()。
- **沉浸式状态栏**：setWindowLayoutFullScreen(true) + getWindowAvoidArea 换 vp 存 AppStorage('statusBarHeightVp'/'navBarHeightVp') + 监听 avoidAreaChange；每个 @Entry 根容器 @StorageProp 并 padding；没开全屏时 setWindowSystemBarProperties 不生效。
- **AVSession**：createAVSession+activate、setAVMetadata+setAVPlaybackState、prepare 前设 STREAM_USAGE_MUSIC；首次真播放才 activate，之后补 metadata+setBackgroundPlayMode。事件名 'play'/'pause'/'playNext'/'playPrevious'/'seek'/'setSpeed'。
- **飞牛源**：目录 `features/network/src/main/ets/fnos/`；分发靠模块级开关（entry 的 applyFnosSession/restoreFnosSession 调 enableFnos()，各 api/*.ets 入口 `if (isFnosSource())`）；加不上请求头的两处：封面→`utils/fnosCover.ets` 下载落盘、音频→`media.createMediaSourceWithUrl(url, headers)`；fnos 源跳过播放缓存/预下载；小部件 `WidgetBridge.downloadBytes` 需补 `getFnosPlaybackHeaders()`；能力缺口：专辑收藏/历史空实现、无上传、音质只 lossless。
- **主题插件**：schema/store 在 products/entry/src/main/ets/theme/（JSON 与 mobile 通用，store key `soundx-player-themes`）；黑胶组件 components/VinylCover.ets（interval 旋转，暂停停表不清角）。mobile 对应 src/components/VinylCover.tsx —— **Reanimated worklet 禁递归引用自身/同组件其他 worklet**（闭包序列化到 UI 线程为 undefined → 动画回调 TypeError 闪退，无 JS 错误边界，2026-11-02 踩坑）；无限循环动画一律 `withRepeat(..., -1, false)`，启动前 value 归一化 %360。

## desktop (React)
- 严禁模块顶层调 React hook；token 在组件函数体内取。
- **打开外链一律用 `tauriOpenExternal`（内部 `invoke('open_url')` → tauri-plugin-opener）**：主程序没注册 plugin-shell，`@tauri-apps/plugin-shell` 的 `open()` 必无声失败（2026-11-12 修「点去下载没反应」的根因）。
- **版本更新走后端 `GET /download/latest?product=audiodock`**（`src/services/update.ts`，与 mobile 同构），`files[].platform` = `macos-arm64/macos-x64/windows-x64/windows-arm64/linux-appimage/linux-deb/android`；GitHub Release 只用来取 changelog body。直链是 MinIO 预签名（5 分钟过期）→ 点下载时重新拉一次再打开。
- backdrop-filter 会毁掉 position:fixed（给 fixed 后代创建包含块）→ 浮层移出该容器。
- LazyImage width/height 内联 style 会盖掉 less 类尺寸 → 固定尺寸传数字 px。
- 封面自适应统一用 `hooks/useAdaptiveCoverSize.ts`（ResizeObserver 实测）；CarMode 容器已含媒体栏压缩，别再手动扣宽。

## desktop (Tauri/Windows)
- **创建新 webview 窗口的 command 必须声明 async**（create_mini_window/create_lyric_window）。同步 command 在 WebView2 IPC 回调线程执行，build() 同步等新 webview 初始化 → 死锁卡死整个事件循环：新窗口白屏（HWND 已建但 Chrome_WidgetWin_0 恒 0x0）+ 主窗口点击全失效（2026-10-26 排查一下午的根因）。
- mini/lyric 窗口已存在时 show+focus 复用，禁止 close 后同 label 立刻重建。
- 主窗口 transparent 仅 macOS 需要；Windows 在 tauri.windows.conf.json 覆盖 transparent:false；mini 窗口 transparent(true)+shadow(false)。
- 白屏定位法：Win32 EnumWindows 看 Chrome_WidgetWin_0 是否 0x0 + %APPDATA%/cn.audiodock.desktop 日志探针 + probe.txt 轮询建窗探针。
- **Windows 任务栏缩略图**：`src-tauri/src/taskbar_thumb.rs`（#[cfg(windows)]）DwmSetIconicThumbnail 封面 + ITaskbarList3 ThumbBar 3 按钮（THBN_CLICKED=0x1800）；Win32/COM 收敛窗口线程，跨线程用 WM_APP 自定义消息。mac 可 `cargo check --target x86_64-pc-windows-msvc` 类型检查。

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
