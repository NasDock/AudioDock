# 播放详情页 · 手机横屏封面展示逻辑

> 覆盖端：`apps/mobile`（Expo/RN）、`apps/harmony`（ArkUI）
> 分支基线：`feat/test`（2026-10-21 复核）
> 相关文件：`apps/mobile/app/player.tsx`、`apps/harmony/products/entry/src/main/ets/pages/PlayerPage.ets`

## 1. 模式判定

| 判定 | mobile | harmony | 说明 |
|---|---|---|---|
| 横屏 | `isLandscape = width > height` | `newVal.width > newVal.height` | 均用容器尺寸，非屏幕尺寸 |
| 手机横屏 | `isPhoneLandscape = isLandscape && height < 500`（dp） | `isPhoneLandscape() = isLandscape && containerHeight > 0 && containerHeight < 500`（vp） | 手机横屏高约 360~430，平板 600+ |
| 轮播模式 | `coverFlowMode = isPhoneLandscape && trackList.length > 1` | `isCoverFlowMode() = isPhoneLandscape() && view.queue.length > 1` | 队列仅 1 首时退化为「单封面 + 中心播放键」 |

平板横屏**不**进入轮播：保持单封面 + 底部悬浮控制条（`needsAutoHide` 判定内容高度是否溢出，溢出才自动隐藏）。

## 2. 轮播布局：堆叠式 1-2-3-2-1

静止态 5 张封面呈金字塔堆叠，中心为当前曲目。

| 位置 | 尺寸 | 缩放 | 中心 x 偏移 | 透明度 | 露出的宽度 |
|---|---|---|---|---|---|
| 中心（pos 0） | 200 | 1 | 0 | 1 | 全宽 |
| 相邻（pos ±1） | 133.3 | 2/3 | 77.8 | 0.85 | 1/3 |
| 最外（pos ±2） | 66.7 | 1/3 | 133.3 | 0.70 | 1/3 |

推导（两端同源注释）：
- pos ±1 可见条 = 133.3/3 ≈ 44.4（自中心封面边缘 100 起）→ 封面中心 x = 100 − 88.9 + 66.7 ≈ 77.8
- pos ±2 可见条 = 66.7/3 ≈ 22.2（自 ±1 可见条边缘 144.4 起）→ 封面中心 x ≈ 133.3

**运动学公式**

```
effPos = (idx − 视觉中心索引) + panX / step        // step = 77.8
x      = 分段线性插值(effPos, 锚点 [0, 77.8, 133.3])
scale  = 分段线性插值(effPos, 锚点 [1, 2/3, 1/3])
alpha  = 1 − |effPos| × 0.15   (下限 0.7)
```

mobile 用 `Animated.interpolate` 的 `inputRange [-2,-1,0,1,2] → outputRange` 实现分段插值；harmony 用 `coverFlowX / coverFlowScale` 手动按 `floor/ceil` 分段求值。

**参与渲染的项**：当前曲目前后各 2 首（`p ∈ [-2, 2]`），越界跳过，**不循环**。

## 3. 层级表达：两端机制不同，视觉一致

目标都是 **1-2-3-2-1：中心最高、两侧对称递减**（越靠边越在底层）。

| 端 | 机制 | 备注 |
|---|---|---|
| mobile | **渲染顺序**：`renderCoverFlow` 把 entries 按 `|basePos|` 降序排，中心项最后渲染 = 最上层 | zIndex/elevation 实测在 Android 无效（带 transform 的兄弟节点 z 排序不生效，仍是 1-2-3-4-5），故彻底弃用 z 机制 |
| harmony | ArkUI `zIndex = 100 − round(|effPos| × 10)` | 封面最高 100、中心播放键 110、手势层 1000 |

mobile 排序只随当前索引变化；`key` 始终是队列绝对索引，React 以 move 复用节点，不重挂载、不重建动画节点。

## 4. 交互

### 4.1 拖拽切歌
- 跟手：`panX` / `coverFlowOffset` 直接跟随手指位移，两端阻尼上限 = `step × 1.5`。
- 队列两端拖拽施加 **30% 阻尼**（第一首往右拖、末首往左拖）。
- 松手结算：位移 > 30% 一步（`progress = offset / step`，阈值 ±0.3）或速度超阈值 → 切一首；否则回弹（220ms）。
  - mobile 速度阈值 `|vx| > 0.4`；harmony `|velocityX| > 400`（vp/s）。
- 吸附切歌（180ms 滑出）完成回调里：**同一帧**切视觉索引 + 归零偏移 → 视觉连续不闪回；随后 `playAt(target)` 异步更新真实当前曲目。

### 4.2 点击命中（按 x 坐标，相对手势层中心）
| 命中区 | 行为 |
|---|---|
| `|dx| ≤ 100` | 播放 / 暂停（中心封面） |
| `100 < |dx| ≤ 144.4` | 跳到相邻曲目 |
| `144.4 < |dx| ≤ 166.7` | 跳到最外曲目 |
| 更外 | 唤回 chrome（无其他操作） |

### 4.3 手势层
- mobile：单个 `View` 挂 `PanResponder`（`onStartShouldSetPanResponder: true` 保证松手能收到），位移 < 10px 判定为点击。
- harmony：末尾透明 `Column`（`#00FFFFFF`）独占 `PanGesture` + `onClick`，`zIndex(1000)` 提到最高层——**普通容器默认也会吞掉下层触摸**，这是「封面区下半部滑不动」的根因。
- 封面项本身不挂任何手势，避免与父级手势竞争（否则滑动失效 + 松手误触）。

## 5. 手机横屏的 chrome（控制组）

手机横屏**完全没有播放控制组**，只剩两样：

| 元素 | mobile | harmony |
|---|---|---|
| 顶部折叠 / 更多按钮 | `landscapeBackBtn` / `landscapeMoreBtn`，`opacity: controlsOpacity` | 顶部 `Row`，`opacity` + `hitTestBehavior` |
| 中心播放 / 暂停键 | 64×64，`rgba(255,255,255,0.25)` 毛玻璃，`pointerEvents="none"` 纯展示，点击由手势层命中 | 64×64，`#40FFFFFF` + `backgroundBlurStyle(Regular)`，`hitTestBehavior(None)` |

- 3 秒无操作自动隐藏（`resetHideTimer`），点击任意位置唤回并重置计时。
- 平板横屏保留底部悬浮控制条（`absolute` 定位，隐藏用 `Visibility.Hidden`，不占命中测试也不影响布局测量）。

## 6. 性能与防闪烁要点

| 要点 | 做法 |
|---|---|
| 动画节点不重建 | mobile `CoverFlowItem` 的 `useMemo` 依赖只含稳定引用（`idx/indexAnim/panX/step`），切歌时 `setValue` 而非重建；否则新旧节点交接间隙原生端回落基准位置（闪烁） |
| 父级重渲染隔离 | `CoverFlowItem` 用 `React.memo`；播放中 `position` 高频刷新不波及封面 |
| 阴影 | 不用 `shadow*` / `elevation`：iOS layer shadow 无 `shadowPath` → 每帧离屏重绘掉帧；Android elevation 无 outline → 画不出投影。改用两层静态深色扩散子层（外大淡 + 内小深） |
| 图片档位 | mobile 轮播恒取 **300 档**（`getImageUrl(..., 300)`，`fadeDuration={0}` 关闭 Android 淡入）+ 前后各 3 首 `Image.prefetch`；harmony `CoverImage` 按 `imgWidth × 2` 量化（200vp → 600 档） |
| 视觉索引与真实曲目解耦 | 维护 `coverFlowVisualIndex` / `pending` ref，避免等待异步 `playAt` 期间旧封面跳回中心 |

## 7. 已知差异 / 遗留

| 项 | 状态 |
|---|---|
| 有声书「跳过片头/片尾」快捷按钮组 | **手机横屏不可达**——mobile `coverFlowMode` 分支与 harmony `isCoverFlowMode()` 分支都只渲染封面/轮播，而手机横屏有声书右列又是播放列表，该快捷入口在手机横屏完全缺失（竖屏、平板横屏有） |
| 队列仅 1 首 | 退化为单封面 + 中心播放键（mobile 走 `landscapeArtworkContainer` 分支，harmony 走 `isPhoneLandscape() && !isCoverFlowMode()` 分支） |
| 单封面图片档位 | mobile 单封面用 900 档、轮播用 300 档，两者视觉清晰度不同 |
| 循环 | 不支持首尾循环，队列两端拖拽 30% 阻尼后回弹 |
