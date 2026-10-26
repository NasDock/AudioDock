# AudioDock 项目长期记忆

## 版本更新弹窗平台过滤（2026-10-26）
- Release body 用 conventional commit scope 标记目标端：无 scope=全端；`feat(mobile)`=仅 mobile；`feat(api)`=仅服务端。三端各自 `classifyRelease(body, platform)`：本端/无 scope→正常弹更新；仅服务端 scope→弹「服务端更新提醒」单按钮视图；仅其他端→不弹窗当已最新；body 无法识别→兜底按全端弹（保持旧行为）。产品动态页不过滤。
- scope 别名表（改动需三端同步）：desktop/electron、mobile/android/ios、hm/harmony/harmonyos/ohos；服务端 api/server/backend/service/services。实现位置：desktop/mobile `hooks/useCheckUpdate.ts`，hm `services/updateService.ets`（ArkTS 版禁 Record 索引用 if/else）。

## 设备标识（deviceId）规范
- deviceId 必须确定性：`computeDeviceId` = md5(clientType␟osName␟osVersion␟brand␟manufacturer␟model␟deviceName) 前12位+端前缀，算法在 `packages/ws/src/deviceId.ts`，改动五端同步。禁止 `xxx_${Date.now()}` 随机 ID（2026-09-21 流转 device_offline 根因）。
- desktop：WS/Login 必用 async `computeStableDeviceId`；hm 用 cryptoFramework MD5+deviceInfo。
- 服务端 transfer_session 支持 targetDeviceName/targetPlatform 兜底；markAllDevicesOffline 清脏数据。

## apps/harmony 构建
- `DEVECO_SDK_HOME=<DevEco>/Contents/sdk`，node 用 DevEco 自带，必须 `env -u NODE_OPTIONS`；`hvigorw --mode module -p product=default -p module=entry@default assembleHap --no-daemon`。
- SDK API 24；报 00303217 先 `--stop-daemon`；构建后跑 `scripts/harmony-cleanup.sh` 清副作用再提交。

## ArkTS/ArkUI 高频坑
- 禁对象 spread/`as const`/indexed access；FontWeight 仅六种；@Builder 内无 const/if；8位hex=`#AARRGGBB`。
- 每组件只能绑一个 bindSheet；宽屏居中要 `preferType: SheetType.CENTER`。
- 触摸：HitTestMode.None 只禁自身，Block 阻断下层；要「不响应+不挡下层」用 Visibility.Hidden；覆盖层须显式 hitTestBehavior(None)。
- AnimateParam.onFinish 存在；悬浮用 Stack 兄弟层；ForEach 动态属性读 @State 现场算。

## hm 沉浸式状态栏
- setWindowLayoutFullScreen(true) + getWindowAvoidArea 换 vp 存 AppStorage('statusBarHeightVp'/'navBarHeightVp') + 监听 avoidAreaChange；每个 @Entry 根容器 @StorageProp 并 padding。没开全屏时 setWindowSystemBarProperties 不生效。

## AVSession 播控
- createAVSession+activate、setAVMetadata+setAVPlaybackState、prepare 前设 STREAM_USAGE_MUSIC；首次真播放才 activate，activate 后补发 metadata+setBackgroundPlayMode。事件名 'play'/'pause'/'playNext'/'playPrevious'/'seek'/'setSpeed'。

## hm 桌面小部件（docs/harmony-widget.md）
- EntryFormAbility 1管4 + WidgetBridge（主→卡）+ WidgetCommandHandler（卡→主）；同 HAP 共享 preferences `audiodock_kv`。
- onAddForm want.parameters key 用 formInfo.IDENTITY_KEY（误用 form_id → updateForm('') 卡片停首屏）。
- preferences 每进程一份缓存：跨进程读走 getFresh/getJSONFresh；跨进程 subscribe 无效 → PlayerStore.notify() 加 pushToWidget 钩子（节流 1000ms）；跨进程单例 store 显式 loadFromStorage。
- 播控必须用 call 事件（message 控不了主 App）；冷启动先 `playerStore.restoreState()`，call 回调 await 再执行。
- 封面三级兜底 data:base64→file://→URL；统一 getImageUrl(path, 300) 走 /image/optimize。后端 Track 字段 id/name/artist/cover/duration/type/path。
- WidgetIcon：状态变化图标用无参 @Builder+双 Image+.visibility 互斥。PlayerStore.togglePlay 的 pause 分支必须显式 `this.state='paused'`。

## 手机横屏封面轮播（hm+mobile）
- 判定：横屏 && 高<500 && queue>1；锚点 1:2:3（66.7/133.3/200），非当前露 1/3；effPos = idx − posAnim（单动画值）。
- **堆叠 1-2-3-2-1 靠渲染顺序不靠 zIndex/elevation**（Android transform 兄弟 z 排序不生效）：entries 按 |basePos| 降序渲染，key=队列绝对索引。
- 防闪烁：单 Animated.Value posAnim 驱动一切；树先于位置（snap 先 setVisualIndex 再 rAF 启动动画；外部切歌 useLayoutEffect）；窗口 ±3 缓冲。
- 列表/轮播封面 ≤300 档 + prefetch 前后各 3 首。

## 播放流转 transfer_session
- emit transfer_session {targetDeviceId, currentTrack, playlist:{list,index}, progress秒}，等 ack（5s）；REST 版 POST /user/devices/transfer。
- deviceId 持久化：desktop/web localStorage、mobile AsyncStorage、hm kvStore，key 均 `audiodock_device_id`（mobile 带 `@` 前缀）。
- hm webSocket.connect 第二参必须传 `{}`。⚠️ desktop web 生产 WS URL 必须绝对路径（serverAddress 以 / 开头时回落 window.location.origin）。

## 四端缓冲进度条
- desktop audio.buffered；mobile useProgress().buffered；hm bufferingUpdate；mini BackgroundAudioManager.buffered。各端 Slider 自带底轨透明+下叠自绘缓存层。遗留：desktop Tauri MiniPlayer 小窗进度不走 currentTime IPC。

## Windows 任务栏缩略图（desktop）
- `apps/desktop/src-tauri/src/taskbar_thumb.rs`（#[cfg(windows)]）：DwmSetIconicThumbnail 封面 + ITaskbarList3 ThumbBar 3 按钮（THBN_CLICKED=0x1800）。Win32/COM 收敛窗口线程，跨线程用 WM_APP 自定义消息。mac 可 cargo check --target x86_64-pc-windows-msvc 类型检查。

## apps/desktop (React)
- 严禁模块顶层调 React hook（Invalid hook call），token 在组件函数体内取。
- backdrop-filter 会毁掉 position:fixed（给 fixed 后代创建包含块）；浮层移出该容器或去祖先 backdrop-filter。
- LazyImage width/height 内联 style 会盖掉 less 类尺寸；固定尺寸传数字 px。
- 封面自适应统一用 `hooks/useAdaptiveCoverSize.ts`（ResizeObserver 实测）；CarMode 容器已含媒体栏压缩，不要再手动扣宽。

## apps/desktop (Tauri/Windows)
- **创建新 webview 窗口的 command 必须声明 async**（create_mini_window/create_lyric_window）。同步 command 在 WebView2 IPC 回调线程里直接执行，build() 同步等待新 webview 初始化 → 死锁卡死整个事件循环：新窗口白屏（HWND 已建但 Chrome_WidgetWin_0 恒 0x0 不可见）+ 主窗口所有点击失效（2026-10-26 排查一下午的根因）。
- mini/lyric 窗口已存在时 show+focus 复用，禁止 close 后同 label 立刻重建（close 异步，竞争导致白屏）。
- 主窗口 transparent 仅 macOS 需要（对齐 Electron `transparent: darwin`），Windows 已在 tauri.windows.conf.json 覆盖 transparent:false；mini 窗口 transparent(true)+shadow(false) 对齐 Electron。
- 远程定位白屏链路法：Win32 EnumWindows 看 Chrome_WidgetWin_0 是否 0x0/不可见（webview 是否初始化）+ %APPDATA%/cn.audiodock.desktop 日志文件探针 + probe.txt 轮询建窗探针隔离 command 上下文。

## 其他
- @soundx/services：father 构建入口指 dist，改 src/ 必须 `cd packages/services && pnpm build`。
- mini 会员支付：plusWechatMpSession→openid；下单 clientType:'miniprogram'+openId；返回 wechatPay 喂 Taro.requestPayment。
- services/mi 小爱音箱：sqlite3（data/xiaoai.db）DB 操作 asyncio.to_thread；唤醒词 DB 优先；API 前缀 /api；docker 挂 auth.json/.mi.token/data/。
- CI：Android job 不用 android-actions/setup-android@v3，ubuntu-latest 自带 SDK。
