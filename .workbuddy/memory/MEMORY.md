# AudioDock 项目长期记忆

## 设备标识（deviceId）规范
- deviceId 必须确定性：`computeDeviceId` = md5(clientType␟osName␟osVersion␟brand␟manufacturer␟model␟deviceName) 前12位 + 端前缀，算法在 `packages/ws/src/deviceId.ts`，全端拼接规则逐字节一致、改动五端同步。
- 禁止 `xxx_${Date.now()}_${random}` 随机 deviceId（存储清了就漂移 → WS 在连 ID 与 DB 对不上、流转永远 device_offline，2026-09-21 故障根因）。
- desktop 区分同步 getter（getOrCreateDeviceId，兼容用）与 async 权威值（computeStableDeviceId，WS/Login 必用后者）；hm 用 cryptoFramework.createMd('MD5') + deviceInfo 字段。
- 服务端 transfer_session 支持 targetDeviceName/targetPlatform 兜底匹配；saveDevice 合并同 userId+name 重复；markAllDevicesOffline 清 deviceId=null 脏数据。

## apps/harmony 构建环境
- hvigor 命令行：`DEVECO_SDK_HOME=/Applications/DevEco-Studio.app/Contents/sdk`（DevEco 内置 SDK 根），node 用 DevEco 自带 `Contents/tools/node/bin/node`，必须 `env -u NODE_OPTIONS`。
- 完整命令：`cd apps/harmony && env -u NODE_OPTIONS DEVECO_SDK_HOME=... PATH=<DevEco node>:$PATH <DevEco>/tools/hvigor/bin/hvigorw --mode module -p product=default -p module=entry@default assembleHap --no-daemon`
- SDK API 24（HarmonyOS 6.1.1），hvigor 6.24.4 不认外部 SDK；报 00303217 先 `hvigorw --stop-daemon`。
- 构建副作用：assembleHap 改 build-profile.json5 + BuildProfile.ets + 产 `_tmp_*`，提交前跑 `bash scripts/harmony-cleanup.sh`。

## ArkTS / ArkUI 高频坑
- 严格模式：禁对象 spread、接口签名禁对象字面量、禁 `as const`、禁 indexed access `T['f']`、禁 `Row().fill()`；FontWeight 仅六种关键字；@Builder 体内无 const/if；`t(key, params)` 参数是 `Array<[string, string|number]>`；formBindingData 用 default import。
- 8 位 hex 颜色是 `#AARRGGBB`（透明度在前）。
- 每组件只能绑一个 bindSheet（第二个顶掉第一个）；宽屏（>=600vp）bindSheet 默认 popup 贴边，居中要显式 `preferType: SheetType.CENTER`。
- Slider 轨道两端内缩 blockSize/2（微信 Slider 同），叠自绘底轨要同步内缩并写死 blockSize/trackThickness；antd 与 react-native-slider 无 inset。
- 触摸语义：HitTestMode.None 只禁自身；Block 会阻断下层兄弟（轮播手势失效根因）；要「不响应+不挡下层+保留测量」用 `Visibility.Hidden`；无 onClick 的容器也吃触摸，覆盖层须显式 `hitTestBehavior(None)`。
- 父 PanGesture + 子 onClick 手势竞争 → 透明手势层独占（100% 透明 Column 统一挂 PanGesture+onClick，按 e.x 命中）。
- AnimateParam 有 onFinish（滑出动画→切歌→无动画归零靠它）；rotate 的 RotateOptions 有 perspective（API 24）。
- 悬浮不占布局用 Stack 兄弟层；ForEach 子项动态属性必须读 @State 现场算（闭包传参会拿到旧值），key 只表达项身份（如队列绝对索引）。

## hm 沉浸式状态栏
- setWindowLayoutFullScreen(true)（services/systemBar.ets）+ getWindowAvoidArea 换 vp 存 AppStorage('statusBarHeightVp'/'navBarHeightVp') + 监听 avoidAreaChange；每个 @Entry 根容器 @StorageProp 这两个值并加 padding（RootShellPage 只 pad Navigation 一次，GlobalBottomBar pad bottom）。
- expandSafeArea 只扩绘制区不改布局；没开全屏时 setWindowSystemBarProperties/statusBarColor 不生效。新增 @Entry 页面必须照抄这套。

## AVSession 通知栏播控
- 三要素：createAVSession+activate；setAVMetadata+setAVPlaybackState；AVPlayer initialized 态首次 prepare 前设 `audioRendererInfo.usage=STREAM_USAGE_MUSIC/AUDIOBOOK`。
- KEEP_BACKGROUND_RUNNING 是 ACL 权限需 AGC 审核（白名单邮件 agconnect@huawei.com）；startBackgroundRunning 在 backgroundTaskManager，每次 play()/setPlaying() 都要再申请。
- 首次真正播放时才 activate，activate 后立刻补发 setAVMetadata + setBackgroundPlayMode(ENABLE_BACKGROUND_PLAY)；进度只在状态翻转/seek/倍速时上报（500ms 持续上报被限频）。
- 事件名是 'play'/'pause'/'playNext'/'playPrevious'/'seek'/'setSpeed'。抓日志 `hdc shell "hilog | grep -iE 'avsession'"`。

## hm 桌面小部件（指南 docs/harmony-widget.md）
- EntryFormAbility 1 管 4 + WidgetBridge（主→卡推送）+ WidgetCommandHandler（卡→主指令）。同 HAP 共享 preferences（`audiodock_kv`）；formName→formId 存 `widget_form_ids_${formName}`。
- onAddForm 的 want.parameters key 必须用 formInfo 常量（IDENTITY_KEY="ohos.extra.param.key.form_identity"，误用 form_id → updateForm('') 卡片停首屏）。
- preferences 每进程一份内存缓存：跨进程数据读走 getFresh/getJSONFresh（PreferencesStore.pull()）。跨进程 subscribe 无效 → PlayerStore.notify() 加 pushToWidget 钩子（动态 import），scheduleSyncNowPlaying 节流 1000ms。跨进程单例 store 必须显式 loadFromStorage（EntryAbility.initialize + EntryFormAbility.ensureKvAndHttpReady 都要）。
- 播控必须用 call 事件（message 落到 FormAbility 进程控不了主 App）：call 直达 EntryAbility `this.callee.on('widgetCommand', ...)`，回包 implements rpc.Parcelable；冷启动先 `restorePromise = playerStore.restoreState()`，call 回调 await 它再执行。
- 卡片封面三级兜底：data:base64 → file:// → URL；列表封面统一下载转 file://（http.createHttp 拉 ARRAY_BUFFER 写 filesDir/widget_covers）。统一 getImageUrl(path, 300) 走 /image/optimize。
- 卡片数据用 features_network 封装 API：playlistApi.list('MUSIC')→PlaylistDto[]；userDataApi.trackHistory()→LoadMoreResp（`.list`）；trackApi.latest()→TrackDto[]。后端 Track 字段是 id/name/artist/cover/duration/type/path（无 title/coverUrl/url）；GET /playlists 返回 tracks:[{id,cover}] + _count:{tracks}。
- 详情页跳转门控：`if (this.carModeEnabled && this.carNavCallback)`。VIP 判定用 plus_user_id。
- WidgetIcon：SVG 放 resources/base/media，Image($r(...))+.fillColor；会随状态变化的图标禁用带参 @Builder，用无参 @Builder + 双 Image + .visibility 互斥。
- PlayerStore.togglePlay 的 pause 分支必须显式同步 `this.state = 'paused'`。

## 手机横屏封面轮播（堆叠式 1-2-3-2-1，hm + mobile 双端）
- 判定：isPhoneLandscape = 横屏 && 高<500（vp/dp）；coverFlowMode = 手机横屏 && queue>1。手机横屏无控制组：轮播 + 封面中心 64×64 播放键（mobile 用 rgba 白 0.25 拟毛玻璃）；chrome 3s 无操作自动隐藏，点击唤回重置计时。平板横屏保留单封面+控制条自动隐藏。
- 布局：锚点 1:2:3（66.7/133.3/200），非当前封面露 1/3；x(0/1/2)=0/77.8/133.3 分段插值；effPos = (idx − currentIndex) + panX/77.8。
- **堆叠顺序 = 1-2-3-2-1（中心最高，对称递减）**：mobile zOrder = 12 − |basePos|×2（iOS zIndex / Android elevation，档位 8~12 低于中心播放键 zIndex 110）；zIndex 非原生可动画，随 basePos 切歌时离散跳变（拖动中当前封面恒在最上，snap 帧互换）。（2026-10-20 修正：此前 mobile 误用 10+basePos 递增 = 1-2-3-4-5）
- 手势：hm 透明手势层独占 PanGesture+onClick；mobile 单容器 PanResponder + Animated.Value。点击按 x 命中（|dx|≤100 播停、100~144.4 相邻、144.4~166.7 跳曲）；松手 >30% 或速度阈值滑出→playAt→offset 归零；两端阻尼 30%。
- 防闪烁：hm ForEach key = 队列绝对索引 + transform 内读 @State 现场算；mobile 动画节点 useMemo 固定（只依赖 idx/indexAnim/panX/step，连 basePos 都不能进依赖），索引变化走 coverFlowIndexAnim setValue；PanResponder 只建一次，回调经 ref 透传。Ionicons play 三角偏左，居中补 marginLeft: 4。
- getImageUrl：≤300 恒走 /image/optimize（webp），>300 内网直连原图很慢 → 列表/轮播必须 ≤300 档 + prefetch 前后各 3 首。playAt(index) 两端均已加。

## 播放流转（transfer_session）WS 链路
- 协议：发起端 emit transfer_session {targetDeviceId, currentTrack, playlist:{list,index}, progress秒} → 服务端按 userId+deviceId 匹配在线 socket → 回 transfer_sent / transfer_failed(device_offline, onlineDeviceIds)；REST 版 POST /user/devices/transfer。必须等 ack（5s 超时）再提示。
- deviceId 各端持久化：desktop/web localStorage `audiodock_device_id`；mobile AsyncStorage `@audiodock_device_id`；harmony kvStore `audiodock_device_id`。
- hm webSocket.connect 第二参必须传 `{}`（undefined 被 ohos 拒 401）。服务端 SyncGateway OnModuleInit 启动 markAllDevicesOffline。
- 调试：本地 = web localhost:5174 + hm Preview + 后端 localhost:3000；真机连 NAS 192.168.1.6:8865。web 设备名用 resolveWebDeviceName()。
- ⚠️ desktop web 生产 WS URL 必须绝对路径：serverAddress 以 `/` 开头（用户填 /api）时强制回落 window.location.origin（2026-09-17 修复）。
- 日志前缀：服务端 [WS]/[WS][Transfer]；客户端 [Transfer]/[SharedSocket]；hm hilog tag A0A001 下 [Socket]/[AuthStore]/[Transfer]。

## STRM 播放链路
- .strm 存 Alist 相对路径；docker-compose 配 STRM_ADDRESS（内网 http://192.168.1.12:5244）；扫描入库时拼完整 URL 写入 track.path；/track/stream/:id 对 http 路径直接 proxyStream。
- ⚠️ 核心问题：内网 STRM_ADDRESS 入库 → 外网客户端直接播放失败；网页端内网能播是走 /track/stream 代理。

## 四端缓冲进度条（已播/缓存/总时长 三段式）
- 数据源：desktop audio.buffered；mobile useProgress().buffered；hm AVPlayer bufferingUpdate（0~100，prepared 态补发 100）；mini BackgroundAudioManager.buffered。
- 各端 Slider 不支持双层轨道 → 自带底轨透明，下叠自绘底轨+缓存层（主题主色 30% 透明；hm 用 '#4D'+primary.substring(3)）。hm 链路：AVPlayerBackend→playbackService→PlayerStore.bufferedPercent→view。
- 遗留：desktop Tauri MiniPlayer 小窗进度不走 currentTime IPC，未加缓存层。

## 其他
- @soundx/services：father 构建入口指 dist，改 src/ 必须 `cd packages/services && pnpm build`。mini 会员支付：plusWechatMpSession→openid，下单 clientType:'miniprogram'+openId，返回 wechatPay 喂 Taro.requestPayment。
- services/mi 小爱音箱：sqlite3（services/mi/data/xiaoai.db），DB 操作 asyncio.to_thread；唤醒词 DB 优先（env 仅种子），voice_listener 30s reload；API 前缀 /api；docker-compose 挂 auth.json/.mi.token/data/。
- apps/desktop (React)：严禁模块顶层调 React hook（Invalid hook call），token 在组件函数体内取。
- CI：Android job 不用 android-actions/setup-android@v3（装已下线 tools 包必失败），ubuntu-latest 自带 SDK。
