# HarmonyOS 桌面小部件开发指南

> 与 iOS `apps/mobile/ios/AudioDockWidget/` 4 种卡片对齐的实现说明。

## 概述

hm 桌面小部件由**一个 FormExtensionAbility** 管 **4 种卡片**，通过 `form_config.json` 的不同 `name` 区分：

| formName | 尺寸 | 组件 | 数据来源 |
|---|---|---|---|
| `widget_player` | 2x2 / 2x4 / 4x4 | `widgets/AudioDockPlayerCard.ets` | 当前播放（title/artist/cover/isPlaying/playMode/isLiked） |
| `widget_playlist` | 4x4 | `widgets/PlaylistCard.ets` | `/playlists/mine` 前 3 条 |
| `widget_history` | 4x4 | `widgets/PlayerHistoryCard.ets` | `/user/track-history?type=MUSIC` 顶部正在播放 + 3 条听过 |
| `widget_latest` | 4x4 | `widgets/LatestCard.ets` | `/tracks/latest?type=MUSIC` 前 5 条 |

非会员显示 `widgets/LockedCard.ets`，点击拉起主 App 会员页。

## 关键路径

```
主 App 进程（EntryAbility）
  ├─ EntryAbility.initialize()
  │   └─ authStore.loadFromStorage()  ← 必须！否则 user.id 永远 null
  ├─ EntryAbility.onCreate()
  │   ├─ widgetBridge.install()  ← 订阅 playerStore / likesHistory
  │   └─ widgetBridge.refreshAll()  ← 同步 VIP/歌单/历史/上新
  └─ playerStore.subscribe → WidgetBridge.syncNowPlaying
                                ├─ writeAndPushNowPlaying(KV + formProvider.updateForm)
                                └─ scheduleSyncNowPlaying 300ms 节流

卡片进程（EntryFormAbility）
  ├─ EntryFormAbility.onCreate()
  │   └─ ensureKvAndHttpReady()
  │       ├─ kvStore.init(this.context)
  │       ├─ authStore.loadFromStorage()  ← 必须！卡片进程独立 process
  │       ├─ httpClient.setBaseURL / setAuthToken
  │       └─ setPlusAuthToken (用于 VIP 判定)
  └─ EntryFormAbility.onAddForm(want)
      ├─ 同步返回空骨架（formBindingData.createFormBindingData）
      └─ 异步 fire-and-forget:
          ├─ widgetBridge.registerForm(formName, formId)
          └─ pushSnapshot(formId, kind)
              └─ loadSnapshotForKind(kind)
                  ├─ readIsLocked()  ← 读 widget_vip KV → 调 plusApi fallback
                  └─ loadKVForKind(...)  ← 读 widget_now_playing / playlists / history / latest
```

## 数据共享（跨进程）

主 App 进程和卡片进程是**独立 process**，共享同一个 HAP 的 preferences（`STORE_NAME = 'audiodock_kv'`）。但**单例 store（AuthStore / httpClient）的内存状态完全不可见**：

- 主 App 进程：内存有 user/token
- 卡片进程：内存 user=null（必须显式 `authStore.loadFromStorage()` 从 KV 恢复）
- **不能假设"主 App 跑过 syncVip 卡片就能用"** —— KV 同步有延迟，且 syncVip 必须显式 `install()` 触发

KV 键约定（对齐 mobile `widget_*` UserDefaults schema）：

| key | 写入方 | 读出方 | 内容 |
|---|---|---|---|
| `widget_now_playing` | `WidgetBridge.syncNowPlaying` | 卡片 / `EntryFormAbility.loadSnapshotForKind` | `NowPlayingSnapshot` |
| `widget_playlists` | `WidgetBridge.syncPlaylists` | 卡片 | `PlaylistsSnapshot` |
| `widget_history` | `WidgetBridge.syncHistory` | 卡片 | `HistorySnapshot` |
| `widget_latest` | `WidgetBridge.syncLatest` | 卡片 | `LatestSnapshot` |
| `widget_vip` | `WidgetBridge.syncVip` | `EntryFormAbility.readIsLocked` | `VipSnapshot` |
| `widget_form_ids_${name}` | `WidgetBridge.registerForm` | `EntryFormAbility.refreshOneForm` | `FormIdsBundle`（name → formId[]） |

## VIP 门控

```typescript
// EntryFormAbility.readIsLocked (formability/EntryFormAbility.ets)
private async readIsLocked(): Promise<boolean> {
  const cached = await kvStore.getJSON<VipSnapshot>(WIDGET_KV_KEYS.vip);
  if (cached && cached.updatedAt > 0) {
    return !cached.isVip;  // 已同步过 → 用缓存
  }
  // 缓存无效 → 实时查 plus API（卡片冷启动时主 App 未跑过 syncVip）
  const plusUserId = await kvStore.get('plus_user_id');
  if (!plusUserId) return false;  // 未登录 → 不锁定
  const status = await plusApi.getVipStatus(plusUserId);
  return !status.isVip;
}
```

**`WidgetBridge.syncVip` 的 ID 选择**：用 `plus_user_id`（独立 Plus 会员系统 ID），**不是** `authStore.user.id`。对齐 mobile `apps/mobile/app/_layout.tsx syncVipState`。

**未登录 plus 时不写 KV**（避免下次 `readIsLocked` 走「缓存有效 → 锁定」分支）。

## 卡片进程陷阱

### FormInfo 没有 formId 字段

`formProvider.getFormsInfo()` 在 API 24 返回的 FormInfo 只有 `bundleName / moduleName / abilityName / name / defaultDimension` 等，**没有 formId**。所以 formName → formId 映射必须由 `EntryFormAbility.onAddForm` 主动注册到 `widget_form_ids_${name}` KV。

### postCardAction 是全局函数

不在任何 import 里，直接调用：

```typescript
postCardAction(this, { action: 'message', params: { message: 'play' } });        // 单 action
postCardAction(this, { action: 'message', params: { message: 'play_track:123' } }); // 带 id 用 : 分隔
postCardAction(this, { action: 'router', abilityName: 'EntryAbility', params: { url: 'audiodock://player' } });  // 拉起主 App
```

### FormExtensionAbility 三个回调必须同步签名

```typescript
// ❌ async onAddForm(want) → 编译失败（同步签名要求同步返回）
// ✅ 同步返回空骨架 + fire-and-forget 异步加载
onAddForm(want: Want): formBindingData.FormBindingData {
  this.afterAddForm(...).catch(...);  // fire-and-forget
  return formBindingData.createFormBindingData(emptyData);
}
```

### form_config.json 字段白名单

- `supportDimensions`：仅允许 `'1*2','2*2','2*4','4*4','1*1','6*4','2*3','3*3'`（**没有 4*2**！）
- `scheduledUpdateTime`：HH:MM 单点（如 `"00:00"`），不是区间
- `defaultDimension`：字符串 `"2*2"`

### ArkTS 严格模式额外约束

- 禁用 `as const`（改 class + static readonly）
- 禁用对象字面量当类型（`Record<...>` 也不行，先 `const x: Record = {}; x['k'] = v;` 两步赋值）
- 禁用 `NowPlayingSnapshot['field']` indexed access type（先 typedef）
- 禁用 `Class.field[key]` 索引访问字段（改 if/switch）
- `FontWeight` 仅 Lighter/Regular/Normal/Medium/Bolder/Bold（**无 SemiBold**）
- `@Builder` 函数体内不能有 const/if（UI 组件直接堆叠）

## 磨砂玻璃

iOS 用 `.blur(radius: 18)`，hm 用 `Image.alt(cover).blur(20)`（HarmonyOS Image.blur 支持任意 number）：

```typescript
// widgets/WidgetBackground.ets
Image(this.cover)
  .width('100%').height('100%')
  .objectFit(ImageFit.Cover)
  .blur(20);
Rect().fill('#00000038');  // 黑 22% 暗化（前景白色文字清晰）
Rect().fill('#FFFFFF14');  // 白 8% 高光（磨砂通透感）
```

## 卡片指令（卡片 → 主 App）

| 指令 | payload | 处理函数 | 对齐 iOS |
|---|---|---|---|
| `play` / `pause` | - | `playerStore.togglePlay` | ✅ |
| `next` / `prev` | - | `playerStore.playNext/Previous` | ✅ |
| `mode` | - | `widgetBridge.cyclePlayMode` | ✅ |
| `like` / `unlike` | - | `likesHistory.likeTrack/unlikeTrack` | ✅ |
| `play_playlist` | `{id}` | `handlePlayPlaylist` → `/playlists/${id}` → `playTrackList` | ✅ |
| `play_history` | `{id}` | `handlePlayHistory` → `/user/track-history?pageSize=50` → `playTrackList(list, index)` | ✅（保留 next/prev 上下文） |
| `play_latest` | `{id}` | `handlePlayLatest` → `/tracks/latest?pageSize=50` → `playTrackList(list, index)` | ✅ |
| `refresh_latest` | - | `widgetBridge.refreshLatestNow` → `syncLatest` | ✅ |

## 调试

### 编译 + 安装

```bash
# 1. 编译
cd apps/harmony && env -u NODE_OPTIONS \
  DEVECO_SDK_HOME="/Applications/DevEco-Studio.app/Contents/sdk" \
  PATH="/Applications/DevEco-Studio.app/Contents/tools/node/bin:$PATH" \
  /Applications/DevEco-Studio.app/Contents/tools/hvigor/bin/hvigorw \
  --mode module -p product=default -p module=entry@default assembleHap --no-daemon

# 2. 还原构建副作用（SDK 降级 + BuildProfile debug 改写）
bash scripts/harmony-cleanup.sh

# 3. 安装到真机
hdc install -r apps/harmony/products/entry/build/default/outputs/default/entry-default-signed.hap
```

### 抓日志

```bash
# 卡片进程日志（卡片进程 tag = EntryFormAbility）
hdc shell "hilog | grep -iE 'EntryFormAbility|WidgetBridge|WidgetCommandHandler|formProvider'"

# 主 App 进程日志
hdc shell "hilog | grep -iE 'EntryAbility|WidgetBridge'"

# 检查 FormExtensionAbility 注册
hdc shell "hilog | grep -iE 'formability|formExtension'"
```

### 已知 bug & 修复

| Bug | 根因 | 修复 |
|---|---|---|
| 4 张卡片全显示 LockedCard（浅金色皇冠 #FFD980 ≈ "黄色背景"） | 主 App + 卡片进程都没调 `authStore.loadFromStorage()`；`WidgetBridge.syncVip` 用 `authStore.user.id`（应该是 `plus_user_id`），未登录时把 `isVip: false, updatedAt: now` 写进 KV | (1) `EntryAbility.initialize` + `EntryFormAbility.ensureKvAndHttpReady` 都加 `authStore.loadFromStorage()`；(2) `syncVip` 改用 `plus_user_id`，未登录不写 KV |
| 卡片背景没磨砂玻璃（直接铺封面） | `WidgetBackground` 没对封面 Image 用 `.blur()` | 加 `.blur(20)` |
| PlaylistCard / LatestCard 背景写死 `#1a1a2e` | 没接 `WidgetBackground` | 改用 `Stack() → WidgetBackground({ cover: firstCover() })` |
| `play_history` / `play_latest` 只播单首 | 早期误复用 `handlePlayTrack` | 拆成独立 `handlePlayHistory` / `handlePlayLatest`，拉整个列表 + 定位索引 + `playTrackList(list, index)` |

### 常见排查流程

1. **卡片一直转圈 / 不显示数据** → 抓 `hilog | grep EntryFormAbility` 看 pushSnapshot 是否失败
2. **VIP 用户被锁定** → 抓 `hilog | grep WidgetBridge`，确认 `syncVip isVip=true`；检查 `widget_vip` KV 是否被旧版本污染（**清 KV 重新安装**）
3. **卡片点播按钮无反应** → 抓 `hilog | grep EntryFormAbility` 看 `onFormEvent` 是否触发；抓 `hilog | grep WidgetCommandHandler` 看 handle 是否成功
4. **卡片封面是 404 / 加载失败** → 后端 `/covers/` 路径未生效；确认 `/image/optimize` route + `preGenerate` 缓存目录有数据

## 端到端对齐表（iOS / hm）

| 维度 | iOS | hm | 备注 |
|---|---|---|---|
| 卡片架构 | 4 个 Widget extension | 1 个 FormExtensionAbility（按 formName 区分） | hm 简化但等价 |
| 封面存储 | 本地文件（App Group container） | URL（每次重网络拉） | iOS 离线可看封面，hm 不能 |
| 主色计算 | 封面 8x8 平均色（UImage → CGContext） | **未实现**，写死 `#3a3a5e` | hm 已知 gap |
| 数据共享 | UserDefaults（App Group） | preferences（同 HAP） | 等价 |
| formId 索引 | N/A（iOS 由 system 持有） | `widget_form_ids_${name}` KV（API 24 FormInfo 无 formId） | hm 特有 workaround |
| postCardAction | `WidgetControlIntent`（iOS 17+） | `postCardAction(global)` | API 等价 |
| 模糊 | `.blur(radius: 18)` | `Image.alt(cover).blur(20)` | 等价 |
| 玻璃覆盖 | `.overlay(Color.white.opacity(0.08))` | `Rect().fill('#FFFFFF14')` | 等价（0x08 ≈ 8% 透明） |
| 暗化 | `.overlay(Color.black.opacity(0.22))` | `Rect().fill('#00000038')` | 等价（0x22 ≈ 22% 透明） |
| 命令下发 | AppIntent → perform() | message 事件 + `:` 分隔 id | 等价 |
| 深链拉起 | `audiodock://` URL + `widgetURL()` | `postCardAction('router', 'audiodock://...')` | 等价 |