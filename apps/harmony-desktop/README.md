# AudioDock HarmonyOS Desktop

基于 ArkTS + WebView 的鸿蒙电脑客户端，1:1 复刻 mobile 应用界面。

## 技术方案

采用 **ArkTS WebView 混合架构**：
- **外壳**: ArkTS 原生应用（处理窗口、系统能力）
- **内容**: React/Vite Web 应用（通过 WebView 加载）

优势：
- 100% UI/UX 一致性
- 代码复用率高
- 可独立 WebView 调试

## 开发

### 前置依赖
- HarmonyOS SDK (API 12+)
- DevEco Studio 4.0+
- Node.js 18+

### 启动开发
```bash
# 1. 构建 Web 资源
cd apps/desktop && pnpm build

# 2. 复制 Web 资源到 harmony-desktop
cp -r apps/desktop/dist-web/* apps/harmony-desktop/entry/src/main/resources/rawfile/

# 3. 使用 DevEco Studio 打开 apps/harmony-desktop
# 4. 在 DevEco Studio 中 Run/Debug
```

### 项目结构
```
apps/harmony-desktop/
├── AppScope/
│   └── app.json5           # 应用配置
├── entry/
│   └── src/main/
│       ├── module.json5   # 模块配置
│       ├── MainAbility/
│       │   └── EntryAbility.ets
│       └── MainAbility/pages/
│           └── Index.ets  # 主页面 (WebView)
└── build-profile.json5    # 构建配置
```

## 构建 HAP

```bash
# 在 DevEco Studio 中
# Build > Build Hap(s)
# 输出: build/outputs/hap/release 或 debug
```
