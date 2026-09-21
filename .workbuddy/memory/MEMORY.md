# AudioDock 项目长期记忆

## 设备标识（deviceId）规范

- **deviceId 必须是确定性的**：`computeDeviceId` = md5(clientType␟osName␟osVersion␟brand␟manufacturer␟model␟deviceName) 前12位 + 端类型前缀。算法在 `packages/ws/src/deviceId.ts`，全端（desktop/mobile/hm/web）拼接规则必须逐字节一致，改动要五端同步。
- **禁止再用 `xxx_${Date.now()}_${random}` 随机生成 deviceId**——存储被清就漂移，导致 WS 在连 ID 与 DB 设备列表 ID 对不上、流转永远 device_offline。这是 2026-09-21 流转故障的根因。
- desktop 端区分「同步 getter」（getOrCreateDeviceId，向后兼容）和「async 权威值」（computeStableDeviceId，WS/Login/注册必须用后者）。hm 端用 cryptoFramework.createMd('MD5')，指纹字段取自 deviceInfo（osFullName/productModel/marketName）。
- 服务端 `transfer_session` 支持 targetDeviceName/targetPlatform 兜底匹配（deviceId 漂移时按 deviceName+platform 回退）；`saveDevice` 自动合并同 userId+name 重复记录；`markAllDevicesOffline` 顺带清 deviceId=null 脏数据。

## apps/harmony 构建环境

- **hvigor 命令行构建**：`DEVECO_SDK_HOME` 指向 DevEco 内置 SDK 根 `/Applications/DevEco-Studio.app/Contents/sdk`（不是 `default/openharmony` 或外部 `~/Library/OpenHarmony/Sdk`）；node 用 DevEco 自带 `Contents/tools/node/bin/node` 且必须 `env -u NODE_OPTIONS`。
- **完整命令**：
  ```bash
  cd apps/harmony && env -u NODE_OPTIONS \
    DEVECO_SDK_HOME="/Applications/DevEco-Studio.app/Contents/sdk" \
    PATH="/Applications/DevEco-Studio.app/Contents/tools/node/bin:$PATH" \
    /Applications/DevEco-Studio.app/Contents/tools/hvigor/bin/hvigorw \
    --mode module -p product=default -p module=entry@default assembleHap --no-daemon
  ```
- SDK API 24（HarmonyOS 6.1.1），hvigor 6.24.4 不认外部 SDK。报 00303217 先 `hvigorw --stop-daemon`。
- **构建副作用**：assembleHap 会改 `build-profile.json5` + 各模块 `BuildProfile.ets` + 产生 `_tmp_*` 空文件，提交前跑 `bash scripts/harmony-cleanup.sh` 还原。

## ArkTS 严格模式高频坑

- 禁对象 spread（arkts-no-spread）、接口签名禁对象字面量、禁 `as const`、禁 indexed access type `T['field']`、禁 `Row().fill()`（改 backgroundColor）。
- FontWeight 仅 Lighter/Regular/Normal/Medium/Bolder/Bold；@Builder 体内不能有 const/if。
- `t(key, params)` 插值参数是 `Array<[string, string|number]>` 元组；@Entry build() 需 if/else 包 builder 调用；`formBindingData` 用 default import 不带花括号。
- **ArkUI 8 位 hex 颜色是 `#AARRGGBB`**（透明度在前，不是 CSS 的 RRGGBBAA）。
- **每组件只能绑定一个 bindSheet**：挂第二个会顶掉第一个，每个 sheet 配一个不可见锚点 Column 分散绑定。

## AVSession 通知栏播控

- 三要素缺一不可：① createAVSession + activate；② setAVMetadata + setAVPlaybackState；③ AVPlayer initialized 态、首次 prepare 前设 `audioRendererInfo.usage = STREAM_USAGE_MUSIC/AUDIOBOOK`。
- `KEEP_BACKGROUND_RUNNING` 是 ACL 受限权限，必须 AGC 审核通过（调试白名单发邮件 agconnect@huawei.com）。
- `startBackgroundRunning` 在 `backgroundTaskManager`（@kit.BackgroundTasksKit）；**每次 play()/setPlaying() 入口都要再申请一次**。
- activate 时机：首次真正播放时激活，空激活不认；activate 后立刻补发 setAVMetadata + setBackgroundPlayMode(ENABLE_BACKGROUND_PLAY)（API 24+）。
- 进度不要持续上报（500ms 一次会被限频拒绝），只在状态翻转/seek/倍速时下发。
- AVSession 事件名是 `'play'/'pause'/'playNext'/'playPrevious'/'seek'/'setSpeed'`（论坛的 'next'/'previous' 是错的）。
- 抓日志：`hdc shell "hilog | grep -iE 'avsession|AVSession'"`。

## hm 桌面小部件（对齐 iOS 4 种 widget）

- **架构**：`EntryFormAbility`（1 管 4）+ 4 个 ArkTS 卡片组件 + `WidgetBridge`（主 App→卡片推送）+ `WidgetCommandHandler`（卡片→主 App 指令）。完整指南见 `docs/harmony-widget.md`。
- **数据共享**：同 HAP 共享 preferences（STORE_NAME `audiodock_kv`）；formName→formId 走 `widget_form_ids_${formName}`。
- **onAddForm 三个 want.parameters key 必须用 formInfo 常量**：`FormParam.IDENTITY_KEY = "ohos.extra.param.key.form_identity"`（误用 `form_id` 会拿空串 → updateForm('') 报 invalid → 卡片永远停首屏）、`NAME_KEY`、`DIMENSION_KEY`（数字枚举归一化 1→1*2, 2→2*2, 3→2*4, 4→4*4, 5→2*1）。
- **preferences 每进程一份内存缓存**：跨进程写入后对方读旧缓存。修复：`PreferencesStore.pull()` + 封装 `getFresh/getJSONFresh`，读「会被对方进程写入」的数据走 fresh 系列。
- **跨进程订阅无效**：playerStore.subscribe 只在主 App 进程内有效。方案：PlayerStore.notify() 里加 pushToWidget 钩子（动态 import 避免循环依赖），scheduleSyncNowPlaying 节流 1000ms。
- **跨进程单例 store 必须显式 loadFromStorage**：EntryAbility.initialize 末尾 + EntryFormAbility.ensureKvAndHttpReady 里都要 `await authStore.loadFromStorage()`。
- FormExtensionAbility import（API 24）：`from '@ohos.app.form.FormExtensionAbility'`；postCardAction 是全局函数；form_config.json supportDimensions 无 4*2；scheduledUpdateTime 必须 HH:MM 单点；FormExtensionAbility 回调必须同步。
- VIP 判定用 `plus_user_id`；未登录不要写 `widget_vip` KV。
- 卡片封面统一 `getImageUrl(path, 300)` 走 `/image/optimize`；play_history / play_latest 是播列表（playTrackList）。
- **播控必须用 call 事件**（message 事件落到 EntryFormAbility 进程无法控制主 App）：call 直达 EntryAbility `this.callee.on('widgetCommand', handler)`，回包必须 `implements rpc.Parcelable`。冷启动时序：EntryAbility.onCreate 先 `restorePromise = playerStore.restoreState()`，call 回调 await 它再执行指令。
- **卡片封面三级兜底**（WidgetCoverResolver）：data:base64 内联（最稳定）→ file:// 本地缓存 → 绝对 URL；**列表封面必须统一下载转 file://**（FormExtensionAbility 对网络 URL 不可靠），resolveCoverToFile 用 http.createHttp 拉 ARRAY_BUFFER → 写 filesDir/widget_covers。
- **卡片列表数据必须用 features_network 封装 API**：歌单 `playlistApi.list('MUSIC')` 返回 `PlaylistDto[]`；历史 `userDataApi.trackHistory()` 返回 `LoadMoreResp<TrackHistoryItem>`（`.list` 不是 `.items`）；上新 `trackApi.latest()` 返回 `TrackDto[]`。后端 Track 模型字段是 `id/name/artist/cover/duration/type/path`，**没有 `title/coverUrl/url`**。后端 GET /playlists 返回 `tracks: [{id, cover}]` + `_count: {tracks}`，封面用 `tracks[0].cover`，计数用 `_count.tracks`。
- **详情页跳转门控用 `carModeEnabled`，不能用 `carNavCallback` 是否存在**：`if (this.carModeEnabled && this.carNavCallback)`。
- **WidgetIcon 用 SVG 资源 + Image 组件**：13 个 SVG 放 `resources/base/media/`，Image($r('app.media.xxx')) + `.width/.height/.fillColor(color)`，SVG 里 fill 写 #FFFFFF 占位。**会随状态变化的图标禁止走带参 @Builder**（按值快照不订阅状态）：修复模式是无参 @Builder + 双 Image + `.visibility(三元)` 互斥切换。
- **`PlayerStore.togglePlay` pause 分支必须显式同步 `this.state = 'paused'`**：用 `this.isPlaying` 判断不用 `this.state`。

## STRM 播放链路（内网/外网）

- `.strm` 文件存 Alist 相对路径（如 `/音乐/xxx.mp3`）；`docker-compose.yml` 配 `STRM_ADDRESS=http://192.168.1.12:5244`（内网）。
- 扫描入库时 `LocalMusicScanner.parseFile` 用 `STRM_ADDRESS + 相对路径` 拼完整 URL 直接写入 track.path。
- 播放：`/track/stream/:id` 若 `track.path.startsWith('http')` 直接 `proxyStream`；鸿蒙端/mobile 端同样直接返回该 URL。
- **⚠️ 核心问题**：STRM_ADDRESS 是内网地址 → 数据库存内网 URL → 外网客户端直接播放内网地址失败。网页端内网能播是因为走 `/track/stream` 代理。

## 播放流转（transfer_session）WS 链路

- **协议**：发起端 emit `transfer_session {targetDeviceId, currentTrack, playlist:{list,index}, progress(秒)}` → 服务端按 userId+deviceId 匹配在线 socket → 命中回 `transfer_sent` + 目标发 `transfer_received`；未命中回 `transfer_failed(reason=device_offline, onlineDeviceIds=[...])`。另有 REST 版 `POST /user/devices/transfer`。
- **必须等服务端 ack 再提示**（5s 超时兜底），emit 后立刻提示成功是假成功。
- **设备注册**：deviceId 各端首启生成持久化（desktop/web: localStorage `audiodock_device_id`；mobile: AsyncStorage `@audiodock_device_id`；harmony: kvStore `audiodock_device_id`）。
- **hm 端 webSocket 连接**：`connect(url, undefined)` 第二参传 undefined 会被 ohos 拒绝（401 Parameter error），必须传 `{}`；URL query 带 encodeURIComponent 后的业务参数安全。
- **服务端 SyncGateway 实现 OnModuleInit**，启动时 `markAllDevicesOffline()` 避免僵尸在线。
- **调试环境区分**：本地调试 = web `localhost:5174` + 鸿蒙 Preview + 后端 `localhost:3000`；真机连 NAS `192.168.1.6:8865`。Preview deviceName 是英文兜底，kvStore 内存降级。
- **web 设备名**用 `resolveWebDeviceName()`（UA 解析成 "Chrome xxx on macOS"），不要存整段 UA。
- **排查日志前缀**：服务端 `[WS]`/`[WS][Transfer]`；客户端 `[Transfer]`/`[SharedSocket]`；hm 端 hilog tag `A0A001/com.audiodock.app/AudioDock` 下的 `[Socket]`/`[AuthStore]`/`[Transfer]`。
- **⚠️ desktop web 生产环境 WS URL 必须绝对路径**：用户在登录框填 `/api`（同源 nginx 代理路径）时，`localStorage.serverAddress` 会存 `/api`；HTTP 请求没问题，但 `socket.ts` 直接把它喂给 socket.io → 相对路径解析失败 → WS 永远连不上 → 生产环境 desktop 无法流转。修复：web 模式下 `serverAddress` 以 `/` 开头时强制回落 `window.location.origin`（nginx 已代理 `/socket.io/`）。（2026-09-17 修复）

## @soundx/services workspace 包

- father 构建，入口指向 dist；**改 src/ 后必须 `cd packages/services && pnpm build`**，否则引用端拿旧 dist 报 `xxx is not a function`。
- mini 会员支付：plusWechatMpSession → openid；下单 clientType:'miniprogram' + openId，返回 wechatPay 直接喂 Taro.requestPayment。

## services/mi 小爱音箱管理

- sqlite3（`services/mi/data/xiaoai.db`），DB 操作必须 asyncio.to_thread 包裹。
- 唤醒词 DB 优先（env VOICE_KEYWORDS 仅首启种子）；voice_listener 每 30s reload。
- 管理 API 前缀 `/api`，前端走 `{服务器}/mi/api/*`。
- docker-compose 需挂载 `auth.json`、`.mi.token`、`data/` 三路径防登录态丢失。

## apps/desktop (React)

- **严禁在模块顶层（组件函数体外）调用任何 React hook**（如 `theme.useToken()`）→ Invalid hook call。token 需用时一律在组件函数体内取。

## GitHub Actions (CI)

- **Android job 不要用 `android-actions/setup-android@v3`**（强制安装已下线的 `tools` 包，ubuntu-24.04 必然失败）。ubuntu-latest 自带完整 Android SDK，直接删 setup action 即可。
