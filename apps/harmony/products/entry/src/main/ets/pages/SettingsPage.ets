import router from '@ohos.router';
import promptAction from '@ohos.promptAction';
import { window } from '@kit.ArkUI';
import { kvStore, fileCache } from 'features_storage';
import { Logger, formatSize } from 'audiodock_common';
import { authStore } from '../context/AuthStore';
import { playerStore } from '../context/PlayerStore';
import { syncStore } from '../context/SyncStore';
import { themeAutoStore } from '../context/ThemeAutoStore';
import { buildTheme } from 'features_ui';
import type { Theme, ThemeMode } from 'features_ui';
import { t, getLang } from 'features_i18n';
import { getInternalQuality, getExternalQuality } from '../services/trackQuality';
import { applySystemBar } from '../services/systemBar';
import { openInBrowser, jumpToAppMarket } from '../utils/browserUtils';
import { plusApi, setPlusAuthToken } from 'features_network';
import { getLatestVersion, fetchReleaseBody, compareVersions } from '../services/updateService';

// 设置项开关行：独立子组件，刻意不用 @Builder。
// 本页踩坑记录（提交 1c419826 起的四轮修复）证明：@Builder 按值内联展开后，
// 其内部节点在父组件 @State 驱动的重建中手势注册不稳定——Toggle 鬼影 onChange(false)、
// enabled(false) 连累整个子树、hitTestBehavior(None) 连累热区、自绘开关在 Builder 内
// 同样点击无响应。独立 @Component 拥有稳定的组件实例与手势识别：
// @Prop 只负责回显父状态，交互只走 onClick 回调（不注册 Toggle 的 onChange，
// 从根上杜绝鬼影事件覆盖存储值）。
@Component
struct SettingSwitchRow {
  label: string = '';
  description: string = '';
  // 双向绑定父组件 @State。真机日志实测：@Prop 在此场景更新链断裂（父 @State 已变，
  // 子组件 tap 时读到的 value 永远是旧值），改 @Link 共享同一状态源，UI 即时跟随。
  @Link value: boolean;
  @Prop disabled: boolean = false;
  onChange: (val: boolean) => void = () => {};

  @StorageLink('themeMode') @Watch('onThemeModeChange') themeMode: ThemeMode = 'light';
  @State theme: Theme = buildTheme('light');

  aboutToAppear() {
    this.theme = buildTheme(this.themeMode);
  }

  onThemeModeChange(): void {
    this.theme = buildTheme(this.themeMode);
  }

  build() {
    Row() {
      Column() {
        Text(this.label)
          .fontSize(17)
          .fontWeight(FontWeight.Medium)
          .fontColor(this.theme.colors.text)
          .margin({ bottom: 4 })
        Text(this.description)
          .fontSize(13)
          .fontColor(this.theme.colors.textSecondary)
      }
      .layoutWeight(1)
      .alignItems(HorizontalAlign.Start)
      .margin({ right: 20 })

      // 自绘 iOS 风格开关（轨道 + 滑块），点击即反转。
      Column() {
        // 滑块
        Column()
          .width(24)
          .height(24)
          .borderRadius(12)
          .backgroundColor('#f4f3f4')
          .translate({ x: this.value ? 12 : -12 })
          .animation({ duration: 200, curve: Curve.EaseInOut })
      }
      .width(48)
      .height(28)
      .borderRadius(14)
      .backgroundColor(this.value ? this.theme.colors.primary : 'rgba(120,120,128,0.32)')
      .justifyContent(FlexAlign.Center)
      .opacity(this.disabled ? 0.5 : 1)
      .onClick((): void => {
        Logger.i('SettingSwitchRow', `tap label=${this.label} value=${this.value} disabled=${this.disabled}`);
        if (!this.disabled) {
          this.onChange(!this.value);
        }
      })
    }
    .width('100%')
    .padding({ top: 15, bottom: 15 })
    .borderWidth({ bottom: 0.5 })
    .borderColor(this.theme.colors.border)
  }
}

@Entry
@Component
struct SettingsPage {
  @StorageLink('themeMode') @Watch('onThemeModeChange') themeMode: ThemeMode = 'light';
  @State private langAtBuild: string = getLang();
  @State theme: Theme = buildTheme('light');

  // 自动主题：@StorageLink 跨页面共享；开启后由 ThemeAutoStore 启动 mediaquery 监听，
  // 系统色变化时自动同步 AppStorage('themeMode')。启动值由 EntryAbility.initialize()
  // 从 kvStore 写入，handleAutoThemeChange 同步 AppStorage + 调 themeAutoStore.setEnabled。
  @StorageLink('autoTheme') autoTheme: boolean = false;
  // 自动横竖屏：@StorageLink 写入 AppStorage 后 MainPage.applyOrientation 立即响应；
  // 启动值由 EntryAbility.initialize() 从 kvStore 写入。下方 handler 同时同步 AppStorage
  // 并立即调用 setPreferredOrientation 切换主窗口方向（不依赖 MainPage 在栈顶）。
  @StorageLink('autoOrientation') autoOrientation: boolean = false;
  @State voiceAssistantEnabled: boolean = false;
  @State activityNotifyEnabled: boolean = true;
  // 车机模式三个字段全部用 @StorageLink：SettingsPage 写入后立即触发 MainPage /
  // GlobalBottomBar / SquirrelAgent / EmbeddedPlayerPanel 等消费者重建（对齐 mobile
  // 的 SettingsContext 订阅模式）。AppStorage 由 EntryAbility.initialize() 从
  // kvStore 恢复，SettingsPage 自身不再读 kvStore.get('carModeEnabled')。
  @StorageLink('carModeEnabled') @Watch('onCarModeStorageChange') carModeEnabled: boolean = false;
  @StorageLink('carPanelsSwapped') carPanelsSwapped: boolean = false;
  @StorageLink('screenBottomInset') screenBottomInset: number = 0;
  @State acceptRelay: boolean = false;
  @State acceptSync: boolean = false;
  @State cacheEnabled: boolean = false;
  @State audiobookMode: boolean = false;
  @State experienceProgramEnabled: boolean = false;
  @State recommendationLikeRatio: number = 50;
  @State internalQuality: string = '';
  @State externalQuality: string = '';
  @State sourceType: string = '';
  @State version: string = '1.2.0.1';
  // 缓存管理三档大小（页面显示文案用）
  @State coverCacheSize: string = '';
  @State musicCacheSize: string = '';
  @State audiobookCacheSize: string = '';
  // 检查更新 / 参与内测 loading
  @State checkingUpdate: boolean = false;
  @State joiningBeta: boolean = false;
  // 车机模式：VIP 门控状态（aboutToAppear 时拉一次）
  @State carModeIsVip: boolean = false;
  // 屏幕边距 Slider 半模态显示控制
  @State screenInsetModalVisible: boolean = false;
  // 屏幕边距 slider 实时拖动值（松手/点击才持久化，对齐 mobile 的 Slider.onChange End 行为）
  @State screenInsetDraft: number = 0;
  // 注销会员账号确认弹窗显示控制（ArkUI promptAction.showDialog 不返回 button index，
  // 必须用 bindContentCover 自定义弹窗才能区分取消 vs 确认，对齐 mobile Alert.alert 行为）
  @State deleteMemberConfirmVisible: boolean = false;
  // 注销请求进行中：禁用弹窗内的确认按钮，避免重复点击
  @State deleteMemberPending: boolean = false;

  aboutToAppear() {
    this.theme = buildTheme(this.themeMode);
    this.loadSettings();
    // 车机模式 VIP 门控（提前预热，避免开关切换时同步等待拉接口）
    this.loadCarModeVipGate();
  }

  onThemeModeChange(): void {
    this.theme = buildTheme(this.themeMode);
  }

  async loadSettings() {
    try {
      this.sourceType = authStore.state_.sourceType;
      // autoTheme / autoOrientation / carModeEnabled / carPanelsSwapped / screenBottomInset
      // 由 EntryAbility 从 kvStore 读出后写入 AppStorage，本页直接走 @StorageLink，
      // 不再重复读 kvStore（避免 loadSettings 异步回填覆盖真实值）。
      this.voiceAssistantEnabled = await this.readBool('voiceAssistantEnabled', false);
      this.activityNotifyEnabled = await this.readBool('activityNotifyEnabled', true);
      // carModeEnabled / carPanelsSwapped / screenBottomInset 由 EntryAbility 从
      // kvStore 读出后写入 AppStorage，本页直接走 @StorageLink，不再重复读 kvStore。
      this.acceptRelay = await this.readBool('acceptRelay', true);
      this.acceptSync = await this.readBool('acceptSync', true);
      this.cacheEnabled = await this.readBool('cacheEnabled', false);
      this.experienceProgramEnabled = await this.readBool('experienceProgramEnabled', true);
      this.audiobookMode = (await kvStore.get('playMode')) === 'AUDIOBOOK';
      const ratioRaw = await kvStore.get('recommendationLikeRatio');
      this.recommendationLikeRatio = ratioRaw ? Number(ratioRaw) : 50;
      this.internalQuality = await getInternalQuality();
      this.externalQuality = await getExternalQuality();
      // 同步控制：把 kvStore 里的开关状态同步到 SyncStore，避免两者脱节
      syncStore.setAcceptSync(this.acceptSync);
      // 缓存三档大小（修复 11：点击无响应 → 让封面/音乐/有声书三行右侧显示当前大小）
      this.loadCacheSizes().catch((e: Error): void => {
        Logger.w('SettingsPage', `loadCacheSizes during loadSettings failed: ${String(e)}`);
      });
    } catch (e) {
      Logger.w('SettingsPage', `load settings failed: ${String(e)}`);
    }
  }

  /**
   * 车机模式 VIP 门控：拉一次 plus profile，缓存 vipTier 给开关切换时同步判断，
   * 避免每次切开关都再调一次 plusApi.getMe。对齐 mobile 的 handleToggleCarMode。
   */
  private async loadCarModeVipGate(): Promise<void> {
    try {
      const token = await kvStore.get('plus_token');
      const userId = await kvStore.get('plus_user_id');
      if (!token || !userId || userId.length === 0) {
        this.carModeIsVip = false;
        return;
      }
      setPlusAuthToken(token);
      let id: string = userId;
      try {
        const parsed = JSON.parse(userId) as string;
        if (parsed) id = parsed;
      } catch { /* keep raw */ }
      const profile = await plusApi.getMe(id);
      const tier = profile?.vipTier;
      this.carModeIsVip = !!tier && tier !== 'NONE';
    } catch (e) {
      Logger.w('SettingsPage', `loadCarModeVipGate failed: ${String(e)}`);
      this.carModeIsVip = false;
    }
  }

  /**
   * @StorageLink('carModeEnabled') 监听：当前仅作埋点钩子，未避免重复重建
   * （@StorageLink 本身已能驱动父组件响应）。保留 @Watch 占位，方便后续接埋点。
   */
  onCarModeStorageChange(): void {
    Logger.i('SettingsPage', `carModeEnabled storage -> ${this.carModeEnabled}`);
  }

  /** 读取布尔设置；未存储过时回退到与 mobile 端一致的默认值。 */
  private async readBool(key: string, fallback: boolean): Promise<boolean> {
    const v = await kvStore.get(key);
    if (v === null) return fallback;
    return v === 'true';
  }

  goBack() {
    router.back();
  }

  async updateBoolSetting(key: string, value: boolean) {
    await kvStore.set(key, value ? 'true' : 'false');
  }

  // ─── 开关交互说明 ───
  // 开关行由文件级的 SettingSwitchRow 子组件实现（见文件顶部），@Prop 回显、
  // onClick 回调翻转，彻底绕开 ArkUI Toggle 在重建时多发 onChange(false) 的鬼影问题
  // （本仓库提交 1c419826 已证实）。这里的 handler 收到的都是真实用户操作，直接写存储。

  setThemeMode(mode: ThemeMode): void {
    AppStorage.setOrCreate('themeMode', mode);
    applySystemBar(mode);
    kvStore.set('themeMode', mode);
  }

  handleAutoThemeChange(val: boolean) {
    // this.autoTheme 由 @StorageLink 自动同步（AppStorage.setOrCreate 在写 kvStore 后立即触发）
    AppStorage.setOrCreate<boolean>('autoTheme', val);
    this.updateBoolSetting('autoTheme', val);
    // 开启立即同步当前系统色到 themeMode；关闭后由 onConfigurationUpdate 自动跳过覆盖。
    themeAutoStore.setEnabled(val);
  }

  handleDarkModeChange(val: boolean) {
    if (this.autoTheme) return;
    if (val) {
      if (this.themeMode !== 'dark') {
        this.setThemeMode('dark');
      }
    } else if (this.themeMode === 'dark') {
      this.setThemeMode('light');
    }
  }

  handleFestiveChange(val: boolean) {
    if (this.autoTheme) return;
    if (val) {
      if (this.themeMode !== 'festive') {
        this.setThemeMode('festive');
      }
    } else if (this.themeMode === 'festive') {
      this.setThemeMode('light');
    }
  }

  handleAutoOrientationChange(val: boolean) {
    // this.autoOrientation 由 @StorageLink 自动同步（AppStorage.setOrCreate 在写 kvStore 后立即触发）
    AppStorage.setOrCreate<boolean>('autoOrientation', val);
    this.updateBoolSetting('autoOrientation', val);
    // 立即应用方向：SettingsPage 自身可能在栈顶，避免等 MainPage 重建才生效。
    // 车机模式开启时横屏锁仍优先（MainPage.applyOrientation 优先级链：carMode > autoOrientation > PORTRAIT）。
    this.applyOrientationImmediate();
  }

  /**
   * 立即按优先级链应用窗口方向：carMode > autoOrientation > PORTRAIT。
   * MainPage.applyOrientation 内部用同一份逻辑，这里抽出独立函数供 SettingsPage 在
   * 自身栈顶时直接调用，避免等 MainPage 重建触发。
   */
  private applyOrientationImmediate(): void {
    const carMode = AppStorage.get<boolean>('carModeEnabled') === true;
    const auto = AppStorage.get<boolean>('autoOrientation') === true;
    let target: window.Orientation = window.Orientation.PORTRAIT;
    if (carMode) {
      target = window.Orientation.LANDSCAPE;
    } else if (auto) {
      target = window.Orientation.AUTO_ROTATION;
    }
    try {
      const ctx: Context = getContext();
      window.getLastWindow(ctx).then((win: window.Window): void => {
        win.setPreferredOrientation(target);
      }).catch((e: Error): void => {
        Logger.w('SettingsPage', `getLastWindow failed: ${String(e)}`);
      });
    } catch (e) {
      Logger.w('SettingsPage', `applyOrientationImmediate failed: ${String(e)}`);
    }
  }

  handleVoiceAssistantChange(val: boolean) {
    Logger.i('SettingsPage', `voiceAssistant -> ${val}`);
    this.voiceAssistantEnabled = val;
    this.updateBoolSetting('voiceAssistantEnabled', val);
  }

  /**
   * 车机模式开关切换（对齐 mobile 的 handleToggleCarMode）：
   * 1. 校验 plus_token + vipTier（会员功能）
   * 2. 持久化到 kvStore
   * 3. 同步到 AppStorage（@StorageLink 立即触发所有订阅者重渲染）
   * 4. 开启时跳回 MainPage 触发横屏左右布局
   */
  async handleCarModeChange(val: boolean): Promise<void> {
    if (val) {
      // 1) 必须登录会员账号
      const plusToken = await kvStore.get('plus_token');
      const plusUserId = await kvStore.get('plus_user_id');
      if (!plusToken || !plusUserId || plusUserId.length === 0) {
        await promptAction.showDialog({
          title: t('common.memberFeature'),
          message: t('common.loginFirst'),
          buttons: [{ text: t('common.ok'), color: '#3F51B5' }],
        }).catch(() => undefined);
        return;
      }
      // 2) 必须 VIP（页面级缓存 + 实时拉取兜底）
      let isVip = this.carModeIsVip;
      if (!isVip) {
        try {
          setPlusAuthToken(plusToken);
          let id: string = plusUserId;
          try {
            const parsed = JSON.parse(plusUserId) as string;
            if (parsed) id = parsed;
          } catch { /* keep raw */ }
          const profile = await plusApi.getMe(id);
          const tier = profile?.vipTier;
          isVip = !!tier && tier !== 'NONE';
          this.carModeIsVip = isVip;
        } catch (e) {
          Logger.w('SettingsPage', `car mode VIP check failed: ${String(e)}`);
        }
      }
      if (!isVip) {
        // [软下线] 前往会员页入口已隐藏，仅保留 VIP 功能提示。恢复时还原 goToMemberPage 按钮、
        // result.index === 1 判断与跳 MemberBenefitsPage 的代码。
        // ArkUI 的 promptAction.showDialog buttons 不支持 onClick 字段，
        // 必须 await 返回值根据 index 判断
        await promptAction.showDialog({
          title: t('settings.vipOnly'),
          message: t('settings.carModeVipOnly'),
          buttons: [
            { text: t('common.cancel'), color: '#888' },
          ],
        }).catch((): undefined => undefined);
        return;
      }
    }
    // 3) 持久化 + 同步 AppStorage
    await this.updateBoolSetting('carModeEnabled', val);
    AppStorage.setOrCreate<boolean>('carModeEnabled', val);
    // 4) 开启时强制跳到 RootShellPage 触发车机布局（对齐 mobile 的 router.replace('/(tabs)')）
    if (val) {
      try {
        router.replaceUrl({ url: 'pages/RootShellPage' });
      } catch (e) {
        Logger.w('SettingsPage', `navigate to MainPage failed: ${String(e)}`);
      }
    }
  }

  /** 切换左右面板位置（车机模式中间圆形按钮触发，本页不直接调用，预留） */
  handleCarPanelsSwappedChange(val: boolean): void {
    this.carPanelsSwapped = val;
    AppStorage.setOrCreate<boolean>('carPanelsSwapped', val);
    this.updateBoolSetting('carPanelsSwapped', val);
  }

  /** 屏幕边距调整入口：点击 ActionRow 打开半模态 */
  openScreenInsetModal(): void {
    this.screenInsetDraft = this.screenBottomInset;
    this.screenInsetModalVisible = true;
  }

  /** 屏幕边距 Slider 松手/点击时才持久化（对齐 mobile Slider.onChange End） */
  commitScreenInset(value: number): void {
    const clamped = Math.round(Math.max(0, Math.min(160, value)));
    this.screenBottomInset = clamped;
    AppStorage.setOrCreate<number>('screenBottomInset', clamped);
    kvStore.set('screenBottomInset', String(clamped)).catch((e: Error): void => {
      Logger.w('SettingsPage', `save screenBottomInset failed: ${String(e)}`);
    });
  }

  /** 屏幕边距重置为 0 */
  resetScreenInset(): void {
    this.screenInsetDraft = 0;
    this.commitScreenInset(0);
  }

  handleRelayChange(val: boolean) {
    this.acceptRelay = val;
    this.updateBoolSetting('acceptRelay', val);
  }

  handleSyncChange(val: boolean) {
    this.acceptSync = val;
    this.updateBoolSetting('acceptSync', val);
    // 同步到 SyncStore，让"接受同步邀请"的实际行为立即跟随开关
    syncStore.setAcceptSync(val);
  }

  handleCacheChange(val: boolean) {
    this.cacheEnabled = val;
    this.updateBoolSetting('cacheEnabled', val);
  }

  handleAudiobookModeChange(val: boolean) {
    this.audiobookMode = val;
    const mode = val ? 'AUDIOBOOK' : 'MUSIC';
    kvStore.set('playMode', mode);
    // 同步 AppStorage，首页/声仓经 @StorageLink('playMode') 实时刷新（对齐 mobile usePlayMode）
    AppStorage.setOrCreate('playMode', mode);
    playerStore.switchContentMode(mode).catch(() => undefined);
  }

  handleRatioChange(value: number) {
    this.recommendationLikeRatio = Math.round(value / 5) * 5;
    kvStore.set('recommendationLikeRatio', String(this.recommendationLikeRatio));
  }

  getQualityLabel(quality: string): string {
    if (quality === 'lossless') return t('settings.playbackQualityLossless');
    if (quality === 'high') return t('settings.playbackQualityHigh');
    return t('settings.playbackQualityLow');
  }

  async logout() {
    try {
      await authStore.logout();
      await kvStore.delete('serverAddress');
      await kvStore.delete('selectedSourceType');
      router.replaceUrl({ url: 'pages/SourceSelectPage' });
    } catch (e) {
      Logger.e('SettingsPage', `logout failed: ${String(e)}`);
    }
  }

  /**
   * 注销会员账号入口（对齐 mobile settings.tsx handleDeleteMemberAccount）：
   * 1) 校验 plus_token；没有就先弹 Toast 并跳 MemberLoginPage
   * 2) 否则弹出自定义确认弹窗（ArkUI showDialog 不返回 button index，必须用 bindContentCover）
   * 3) 用户在弹窗内点「确认注销」才真正调 plusApi.deleteMe()
   */
  private async handleDeleteMemberAccount(): Promise<void> {
    const plusToken: string | null = await kvStore.get('plus_token');
    if (!plusToken) {
      promptAction.showToast({ message: t('settings.loginFirst') });
      router.replaceUrl({ url: 'pages/MemberLoginPage' });
      return;
    }
    this.deleteMemberConfirmVisible = true;
  }

  /**
   * 用户在确认弹窗里点「确认注销」后真正调接口（替代 showDialog.then 拿 buttonIndex 的写法）。
   * 成功：清理 plus 状态、Toast 成功、跳 MemberLoginPage；失败：Toast 失败。
   */
  private async confirmDeleteMemberAccount(): Promise<void> {
    if (this.deleteMemberPending) {
      return;
    }
    this.deleteMemberPending = true;
    try {
      const res = await plusApi.deleteMe();
      if (!res || !res.ok) {
        throw new Error('deleteMe returned ok=false');
      }
      // 清理会员态（对齐 mobile：setPlusToken(null) + 清 kvStore）
      setPlusAuthToken(null);
      await kvStore.delete('plus_token');
      await kvStore.delete('plus_userId');
      this.deleteMemberConfirmVisible = false;
      promptAction.showToast({ message: t('settings.deleteMemberSuccess') });
      router.replaceUrl({ url: 'pages/MemberLoginPage' });
    } catch (e) {
      Logger.e('SettingsPage', `deleteMemberAccount failed: ${String(e)}`);
      promptAction.showToast({ message: t('settings.deleteMemberFailed') });
    } finally {
      this.deleteMemberPending = false;
    }
  }

  @Builder
  SectionTitle(title: string) {
    Text(title)
      .fontSize(14)
      .fontWeight(FontWeight.Bold)
      .fontColor(this.theme.colors.primary)
      .opacity(0.6)
      .margin({ top: 30, bottom: 10 })
      .width('100%')
  }

  // ═══ 深色模式 / 春日主题专用开关行 ═══
  // 这两个开关的值来自 @StorageLink('themeMode') 的派生表达式（themeMode === 'dark'），
  // 没有对应的父组件 @State 字段可供 @Link 反向写入，因此不能像其他开关那样用
  // SettingSwitchRow 的 @Link 双向绑定。这里用「单向回显 + 回调写主题」的模式：
  // 回显值由父组件表达式计算后传入，点击只调 handler 写 themeMode，
  // themeMode 变化 → 表达式重算 → 新值传回，完成闭环。
  @Builder
  ThemeSwitchRow(label: string, description: string, value: boolean, onChange: (val: boolean) => void, disabled: boolean) {
    Row() {
      Column() {
        Text(label)
          .fontSize(17)
          .fontWeight(FontWeight.Medium)
          .fontColor(this.theme.colors.text)
          .margin({ bottom: 4 })
        Text(description)
          .fontSize(13)
          .fontColor(this.theme.colors.textSecondary)
      }
      .layoutWeight(1)
      .alignItems(HorizontalAlign.Start)
      .margin({ right: 20 })

      Column() {
        Column()
          .width(24)
          .height(24)
          .borderRadius(12)
          .backgroundColor('#f4f3f4')
          .translate({ x: value ? 12 : -12 })
          .animation({ duration: 200, curve: Curve.EaseInOut })
      }
      .width(48)
      .height(28)
      .borderRadius(14)
      .backgroundColor(value ? this.theme.colors.primary : 'rgba(120,120,128,0.32)')
      .justifyContent(FlexAlign.Center)
      .opacity(disabled ? 0.5 : 1)
      .onClick((): void => {
        if (!disabled) {
          onChange(!value);
        }
      })
    }
    .width('100%')
    .padding({ top: 15, bottom: 15 })
    .borderWidth({ bottom: 0.5 })
    .borderColor(this.theme.colors.border)
  }

  @Builder
  ActionRow(label: string, description: string, onPress: () => void, valueText: string = '') {
    Row() {
      Column() {
        Text(label)
          .fontSize(17)
          .fontWeight(FontWeight.Medium)
          .fontColor(this.theme.colors.text)
          .margin({ bottom: 4 })
        Text(description)
          .fontSize(13)
          .fontColor(this.theme.colors.textSecondary)
      }
      .layoutWeight(1)
      .alignItems(HorizontalAlign.Start)
      .margin({ right: 20 })

      Row() {
        if (valueText.length > 0) {
          Text(valueText)
            .fontSize(14)
            .fontWeight(FontWeight.Medium)
            .fontColor(this.theme.colors.textSecondary)
            .margin({ right: 6 })
        }
        Text('›')
          .fontSize(20)
          .fontColor(this.theme.colors.textSecondary)
      }
    }
    .width('100%')
    .padding({ top: 15, bottom: 15 })
    .borderWidth({ bottom: 0.5 })
    .borderColor(this.theme.colors.border)
    .onClick(onPress)
  }

  onPageShow(): void {
    // 语言可能在后台（语言页/系统设置）被修改：回显时若语言已变化，切换 if 分支重建整页。
    // 不能在隐藏时重建——@StorageProp 在后台更新触发的重建会导致路由页触摸失效，
    // 因此用 langAtBuild 把重建延迟到页面可见时。
    const cur = getLang();
    if (cur !== this.langAtBuild) this.langAtBuild = cur;

    // 从 PlaybackQualityPage 返回时，若 quality 被改过，回显要重新拉 KV
    const shouldReload: boolean = AppStorage.get<boolean>('settingsPageShouldReload') === true;
    if (shouldReload) {
      AppStorage.setOrCreate('settingsPageShouldReload', false);
      this.loadSettings().catch((e: Error): void => {
        Logger.w('SettingsPage', `reload after quality change failed: ${String(e)}`);
      });
    }
  }

  build() {
    // 语言切换时重建整页：条件读取 langAtBuild 建立依赖（框架只追踪读取状态变量的表达式，
    // t() 是普通函数无法被追踪），语言变化使 if 分支切换，旧子树销毁、新子树重建，
    // 所有 t() 文案（含局部 @Builder 和 @Prop 传串的子组件）都按新语言重新求值。
    if (this.langAtBuild === 'zh-CN') {
      this.LocalizedContent()
    } else {
      this.LocalizedContent()
    }
  }

  @Builder
  LocalizedContent() {
    Column() {
      // Header
      Row() {
        Button() {
          Text('‹')
            .fontSize(28)
            .fontColor(this.theme.colors.text)
        }
        .width(40)
        .height(40)
        .backgroundColor(Color.Transparent)
        .onClick((): void => this.goBack())

        Text(t('settings.title'))
          .fontSize(20)
          .fontWeight(FontWeight.Bold)
          .fontColor(this.theme.colors.text)
          .layoutWeight(1)
          .textAlign(TextAlign.Center)

        Row().width(40).height(40)
      }
      .width('100%')
      .padding({ left: 15, right: 15, top: 16, bottom: 15 })

      Scroll() {
        Column() {
          // ═══ 服务器 Section ═══
          this.SectionTitle(t('settings.server'))

          this.ActionRow(
            t('settings.sourceManage'),
            t('settings.sourceManageDescription'),
            () => router.pushUrl({ url: 'pages/SourceManagePage' }),
          )

          // ═══ 通用 Section ═══
          this.SectionTitle(t('settings.general'))

          // 语言
          this.ActionRow(
            t('settings.language'),
            t('settings.languageDescription'),
            () => router.pushUrl({ url: 'pages/LanguagePage' }),
          )

          // 内网播放品质
          this.ActionRow(
            t('settings.internalPlaybackQuality'),
            t('settings.internalPlaybackQualityDescription'),
            () => {
              // 用 AppStorage 替代 router.getParams()：aboutToAppear 阶段 getParams 经常拿不到，
              // 改为 PlaybackQualityPage 在 onPageShow 时从 AppStorage 读
              AppStorage.setOrCreate('pendingPlaybackQuality', { network: 'internal' });
              router.pushUrl({ url: 'pages/PlaybackQualityPage', params: { network: 'internal' } });
            },
            this.getQualityLabel(this.internalQuality),
          )

          // 外网播放品质
          this.ActionRow(
            t('settings.externalPlaybackQuality'),
            t('settings.externalPlaybackQualityDescription'),
            () => {
              AppStorage.setOrCreate('pendingPlaybackQuality', { network: 'external' });
              router.pushUrl({ url: 'pages/PlaybackQualityPage', params: { network: 'external' } });
            },
            this.getQualityLabel(this.externalQuality),
          )

          // TTS 服务配置
          this.ActionRow(
            t('settings.ttsConfig'),
            t('settings.ttsConfigDescription'),
            () => router.pushUrl({ url: 'pages/TtsConfigPage' }),
          )

          // 车机模式
          SettingSwitchRow({
            label: t('settings.carMode'),
            description: t('settings.carModeDescription'),
            value: this.carModeEnabled,
            onChange: (val: boolean): void => {
              this.handleCarModeChange(val).catch((e: Error): void => {
                Logger.w('SettingsPage', `handleCarModeChange rejected: ${String(e)}`);
              });
            },
          })

          // 车机模式开启后：屏幕边距调整入口（滑动调整底部安全区，对齐 mobile Slider modal）
          if (this.carModeEnabled) {
            this.ActionRow(
              t('settings.screenInset'),
              t('settings.screenInsetDescription'),
              () => this.openScreenInsetModal(),
              `${this.screenBottomInset}`,
            )
          }

          // 跟随系统主题
          SettingSwitchRow({
            label: t('settings.autoTheme'),
            description: t('settings.autoThemeDescription'),
            value: this.autoTheme,
            onChange: (val: boolean): void => this.handleAutoThemeChange(val),
          })

          // 深色模式
          Column() {
            this.ThemeSwitchRow(
              t('settings.darkMode'),
              t('settings.darkModeDescription'),
              this.themeMode === 'dark',
              (val: boolean): void => this.handleDarkModeChange(val),
              this.autoTheme,
            )

            // 春日主题
            this.ThemeSwitchRow(
              t('settings.festiveTheme'),
              t('settings.festiveThemeDescription'),
              this.themeMode === 'festive',
              (val: boolean): void => this.handleFestiveChange(val),
              this.autoTheme,
            )
          }
          .opacity(this.autoTheme ? 0.5 : 1)

          // 自动横竖屏
          SettingSwitchRow({
            label: t('settings.autoOrientation'),
            description: t('settings.autoOrientationDescription'),
            value: this.autoOrientation,
            onChange: (val: boolean): void => this.handleAutoOrientationChange(val),
          })

          // 语音助手
          SettingSwitchRow({
            label: t('settings.voiceAssistant'),
            description: t('settings.voiceAssistantDescription'),
            value: this.voiceAssistantEnabled,
            onChange: (val: boolean): void => this.handleVoiceAssistantChange(val),
          })

          // 活动通知
          SettingSwitchRow({
            label: t('settings.activityNotify'),
            description: t('settings.activityNotifyDescription'),
            value: this.activityNotifyEnabled,
            onChange: (val: boolean): void => {
              this.activityNotifyEnabled = val;
              this.updateBoolSetting('activityNotifyEnabled', val).catch((e: Error): void => {
                Logger.w('SettingsPage', `updateBoolSetting activityNotifyEnabled rejected: ${String(e)}`);
              });
            },
          })

          // 推荐偏好
          Column() {
            Text(t('settings.recommendationPreference'))
              .fontSize(17)
              .fontWeight(FontWeight.Medium)
              .fontColor(this.theme.colors.text)
              .margin({ bottom: 4 })
            Text(`${t('settings.like')} ${this.recommendationLikeRatio}% · ${t('settings.fresh')} ${100 - this.recommendationLikeRatio}%`)
              .fontSize(13)
              .fontColor(this.theme.colors.textSecondary)
            Slider({
              value: this.recommendationLikeRatio,
              min: 0,
              max: 100,
              step: 5,
            })
              .selectedColor(this.theme.colors.primary)
              .trackColor(this.theme.colors.border)
              .blockColor(this.theme.colors.primary)
              .width('100%')
              .height(28)
              .margin({ top: 8 })
              .onChange((value: number): void => this.handleRatioChange(value))
          }
          .width('100%')
          .alignItems(HorizontalAlign.Start)
          .padding({ top: 15, bottom: 15 })
          .borderWidth({ bottom: 0.5 })
          .borderColor(this.theme.colors.border)

          // 有声书模式 (仅非 Subsonic 源显示)
          if (this.sourceType !== 'Subsonic') {
            SettingSwitchRow({
              label: t('settings.audiobookMode'),
              description: t('settings.audiobookModeDescription'),
              value: this.audiobookMode,
              onChange: (val: boolean): void => this.handleAudiobookModeChange(val),
            })
          }

          // 接力播放
          SettingSwitchRow({
            label: t('settings.relayPlay'),
            description: t('settings.relayPlayDescription'),
            value: this.acceptRelay,
            onChange: (val: boolean): void => this.handleRelayChange(val),
          })

          // 同步控制
          SettingSwitchRow({
            label: t('settings.syncControl'),
            description: t('settings.syncControlDescription'),
            value: this.acceptSync,
            onChange: (val: boolean): void => this.handleSyncChange(val),
          })

          // 边听边存
          SettingSwitchRow({
            label: t('settings.cacheWhilePlaying'),
            description: t('settings.cacheWhilePlayingDescription'),
            value: this.cacheEnabled,
            onChange: (val: boolean): void => this.handleCacheChange(val),
          })

          // ═══ 存储管理 Section ═══
          this.SectionTitle(t('settings.storage'))

          // 封面缓存
          this.ActionRow(
            t('settings.coverCache'),
            `${this.coverCacheSize} · ${t('settings.tapToClear')}`,
            (): void => { this.confirmClearCache('covers'); },
          )

          // 音乐缓存
          this.ActionRow(
            t('settings.musicCache'),
            `${this.musicCacheSize} · ${t('settings.tapToClear')}`,
            (): void => { this.confirmClearCache('music'); },
          )

          // 有声书缓存
          this.ActionRow(
            t('settings.audiobookCache'),
            `${this.audiobookCacheSize} · ${t('settings.tapToClear')}`,
            (): void => { this.confirmClearCache('audiobooks'); },
          )

          // ═══ 关于 Section ═══
          this.SectionTitle(t('settings.about'))

          this.ActionRow(
            t('settings.productUpdates'),
            t('settings.productUpdatesDescription'),
            (): void => { router.pushUrl({ url: 'pages/ProductUpdatesPage' }); },
          )

          this.ActionRow(
            t('settings.checkUpdate'),
            t('settings.checkUpdateDescription'),
            (): void => { this.handleCheckUpdate(); },
          )

          this.ActionRow(
            t('settings.joinBetaTest'),
            t('settings.betaTestDescription'),
            (): void => { this.handleJoinBeta(); },
          )

          this.ActionRow(
            t('settings.userAgreement'),
            t('settings.userAgreementDescription'),
            (): void => { openInBrowser(getContext(this), 'https://www.audiodock.cn/docs/user-agreement/'); },
          )

          this.ActionRow(
            t('settings.privacyPolicy'),
            t('settings.privacyPolicyDescription'),
            (): void => { openInBrowser(getContext(this), 'https://www.audiodock.cn/docs/privacy-policy/'); },
          )

          SettingSwitchRow({
            label: t('settings.experienceProgram'),
            description: t('settings.experienceProgramDescription'),
            value: this.experienceProgramEnabled,
            onChange: (val: boolean): void => {
              this.experienceProgramEnabled = val;
              this.updateBoolSetting('experienceProgramEnabled', val);
            },
          })

          // ═══ 退出登录 ═══
          Button(t('settings.logout'))
            .width('100%')
            .height(50)
            .backgroundColor('#FF3B30')
            .fontColor('#FFFFFF')
            .fontSize(17)
            .fontWeight(FontWeight.Medium)
            .borderRadius(12)
            .margin({ top: 30 })
            .onClick(() => this.logout())

          // ═══ 注销会员账号（对齐 mobile settings.tsx deleteMemberButton） ═══
          Button(t('settings.deleteMemberAccount'))
            .width('100%')
            .height(50)
            .backgroundColor('#FFF1F0')
            .fontColor('#CF1322')
            .fontSize(17)
            .fontWeight(FontWeight.Medium)
            .borderRadius(12)
            .border({ width: 1, color: '#FFCCC7' })
            .margin({ top: 12 })
            .onClick(() => this.handleDeleteMemberAccount())

          // Footer version
          Text(`AudioDock HarmonyOS v${this.version}`)
            .fontSize(12)
            .fontColor(this.theme.colors.textSecondary)
            .margin({ top: 50, bottom: 40 })
            .textAlign(TextAlign.Center)
            .width('100%')
        }
        .width('100%')
        .padding({ left: 20, right: 20 })
      }
      .width('100%')
      .layoutWeight(1)
      .scrollBar(BarState.Off)

      // 车机模式屏幕边距 Slider 半模态（对齐 mobile settings.tsx 的 screenInset Modal）
      Column().width(0).height(0)
        .bindSheet($$this.screenInsetModalVisible, this.screenInsetSheet(), {
          height: 360,
          dragBar: true,
          backgroundColor: this.theme.colors.surface,
        })

      // 注销会员账号二次确认弹窗（ArkUI promptAction.showDialog 不返回 button index，
      // 用 bindContentCover + 自定义按钮区分取消 vs 确认，对齐 mobile Alert.alert 行为）
      Column().width(0).height(0)
        .bindContentCover($$this.deleteMemberConfirmVisible, this.deleteMemberConfirmCover(), {
          modalTransition: ModalTransition.DEFAULT,
          backgroundColor: 'rgba(0,0,0,0.5)',
          onDisappear: (): void => {
            // 弹窗关闭时复位 pending，避免下次打开时按钮仍处于禁用
            this.deleteMemberPending = false;
          },
        })
    }
    .width('100%')
    .height('100%')
    .backgroundColor(this.theme.colors.background)
  }

  /** 注销会员账号二次确认全屏弹窗（对齐 mobile settings.tsx handleDeleteMemberAccount 的 Alert.alert） */
  @Builder
  deleteMemberConfirmCover() {
    Stack() {
      // 半透明遮罩，点击空白处关闭弹窗（取消语义）
      Column()
        .width('100%')
        .height('100%')
        .onClick((): void => {
          if (!this.deleteMemberPending) {
            this.deleteMemberConfirmVisible = false;
          }
        })

      // 居中卡片
      Column() {
        Text(t('settings.deleteMemberAccount'))
          .fontSize(18)
          .fontWeight(FontWeight.Bold)
          .fontColor(this.theme.colors.text)
          .margin({ top: 24, bottom: 12 })
          .textAlign(TextAlign.Center)

        Text(t('settings.deleteMemberConfirm'))
          .fontSize(14)
          .fontColor(this.theme.colors.textSecondary)
          .lineHeight(20)
          .padding({ left: 24, right: 24 })
          .textAlign(TextAlign.Center)

        Row() {
          Button(t('common.cancel'))
            .layoutWeight(1)
            .height(44)
            .backgroundColor(this.theme.colors.surface)
            .fontColor(this.theme.colors.text)
            .fontSize(15)
            .borderRadius(10)
            .border({ width: 1, color: this.theme.colors.border })
            .enabled(!this.deleteMemberPending)
            .onClick((): void => {
              this.deleteMemberConfirmVisible = false;
            })

          Button(this.deleteMemberPending ? t('common.loading') : t('settings.deleteMemberAccount'))
            .layoutWeight(1)
            .height(44)
            .backgroundColor('#CF1322')
            .fontColor('#FFFFFF')
            .fontSize(15)
            .fontWeight(FontWeight.Medium)
            .borderRadius(10)
            .margin({ left: 12 })
            .enabled(!this.deleteMemberPending)
            .onClick((): void => {
              this.confirmDeleteMemberAccount();
            })
        }
        .width('100%')
        .padding({ left: 24, right: 24, top: 24, bottom: 24 })
      }
      .width('80%')
      .constraintSize({ maxWidth: 420 })
      .backgroundColor(this.theme.colors.card)
      .borderRadius(16)
    }
    .width('100%')
    .height('100%')
  }

  /** 屏幕边距调整半模态（对齐 mobile Slider 0–160 + 重置） */
  @Builder
  screenInsetSheet() {
    Column() {
      Text(t('settings.screenInset'))
        .fontSize(16)
        .fontWeight(FontWeight.Bold)
        .fontColor(this.theme.colors.text)
        .margin({ top: 8, bottom: 16 })

      Text(`${this.screenInsetDraft} px · ${t('settings.bottomInset')}`)
        .fontSize(13)
        .fontColor(this.theme.colors.textSecondary)
        .margin({ bottom: 16 })

      Slider({
        value: this.screenInsetDraft,
        min: 0,
        max: 160,
        step: 5,
      })
        .width('90%')
        .trackColor(this.theme.colors.border)
        .selectedColor(this.theme.colors.primary)
        .blockColor(this.theme.colors.primary)
        .onChange((value: number, mode: SliderChangeMode): void => {
          // 松手/点击才持久化（对齐 mobile 的 Slider.onChange End）
          if (mode === SliderChangeMode.End || mode === SliderChangeMode.Click) {
            this.commitScreenInset(value);
          } else {
            this.screenInsetDraft = Math.round(value);
          }
        })

      Row({ space: 12 }) {
        Button(t('common.reset'))
          .layoutWeight(1)
          .height(44)
          .backgroundColor(this.theme.colors.border)
          .fontColor(this.theme.colors.text)
          .borderRadius(8)
          .onClick(() => this.resetScreenInset())

        Button(t('common.done'))
          .layoutWeight(1)
          .height(44)
          .backgroundColor(this.theme.colors.primary)
          .fontColor('#FFFFFF')
          .borderRadius(8)
          .onClick(() => {
            this.commitScreenInset(this.screenInsetDraft);
            this.screenInsetModalVisible = false;
          })
      }
      .width('90%')
      .margin({ top: 24 })
    }
    .width('100%')
    .padding({ left: 16, right: 16, bottom: 16 })
    .alignItems(HorizontalAlign.Center)
  }

  // ─── 修复 11：缓存清理 / 检查更新 / 参与内测 的 handler 实现 ───

  /**
   * 加载三档缓存大小（settings.coverCache / musicCache / audiobookCache 行右侧文案）。
   * 对齐 mobile apps/mobile/app/settings.tsx renderCacheRow 调用 getDetailedCacheSize。
   */
  private async loadCacheSizes(): Promise<void> {
    try {
      const sizes = await fileCache.sizeByCategory();
      this.coverCacheSize = formatSize(sizes['covers'] ?? 0);
      this.musicCacheSize = formatSize(sizes['music'] ?? 0);
      this.audiobookCacheSize = formatSize(sizes['audiobooks'] ?? 0);
    } catch (e) {
      Logger.w('SettingsPage', `loadCacheSizes failed: ${String(e)}`);
      this.coverCacheSize = '-';
      this.musicCacheSize = '-';
      this.audiobookCacheSize = '-';
    }
  }

  /**
   * 缓存清理确认弹窗（覆盖/音乐/有声书三档共用）。
   * 对齐 mobile settings.tsx handleClearCache 的 Alert.alert 二次确认。
   */
  private confirmClearCache(category: 'covers' | 'music' | 'audiobooks'): void {
    const sizeText: string = category === 'covers'
      ? this.coverCacheSize
      : category === 'music'
        ? this.musicCacheSize
        : this.audiobookCacheSize;
    const labelKey: string = category === 'covers'
      ? 'settings.coverCache'
      : category === 'music'
        ? 'settings.musicCache'
        : 'settings.audiobookCache';
    promptAction.showDialog({
      title: `${t(labelKey)} · ${sizeText}`,
      message: t('settings.cacheConfirmMessage'),
      buttons: [
        { text: t('common.cancel'), color: this.theme.colors.textSecondary },
        { text: t('settings.cacheConfirmClear'), color: this.theme.colors.primary },
      ],
    }).then((result): void => {
      // promptAction.showDialog 不返回 index；用 result.index（-1 表示关闭）兜底确认
      if (result && result.index === 1) {
        this.clearCache(category);
      } else {
        // 兜底：用户点了主按钮但 index 解析失败，按"按了确认"处理
        // 某些 API 版本下 result.index 始终为 0，需要二次 prompt 确认。
        // 这里采取保守策略：仅当用户主动点确认按钮才执行清理。
      }
    }).catch((e: Error): void => {
      Logger.w('SettingsPage', `clear cache confirm dialog failed: ${String(e)}`);
    });
  }

  private async clearCache(category: 'covers' | 'music' | 'audiobooks'): Promise<void> {
    try {
      await fileCache.clearCategory(category);
      await this.loadCacheSizes();
      promptAction.showToast({ message: t('settings.cacheCleared') });
    } catch (e) {
      Logger.w('SettingsPage', `clear cache(${category}) failed: ${String(e)}`);
      promptAction.showToast({ message: t('common.operationFailed') });
    }
  }

  /**
   * 检查更新（对齐 mobile handleCheckUpdate）：拉 GitHub releases/latest，
   * 有新版本就弹窗显示更新说明 + 跳转链接；无新版本 toast 提示。
   */
  private async handleCheckUpdate(): Promise<void> {
    if (this.checkingUpdate) return;
    this.checkingUpdate = true;
    try {
      const latestTag: string = await getLatestVersion();
      if (latestTag.length === 0) {
        promptAction.showToast({ message: t('common.operationFailed') });
        return;
      }
      const localVer: string = `v${this.version}`;
      // 仅当远端版本号 > 本地版本号时提示有新版本；否则当作"已是最新"
      if (compareVersions(latestTag, localVer) > 0) {
        const info = await fetchReleaseBody(latestTag);
        const body: string = info?.body ?? '';
        promptAction.showDialog({
          title: t('settings.updateAvailable', [['version', latestTag]]),
          message: body.length > 0 ? body : latestTag,
          buttons: [
            { text: t('common.close'), color: this.theme.colors.textSecondary },
            { text: t('settings.goUpdate'), color: this.theme.colors.primary },
          ],
        }).then((res): void => {
          // showDialog 回调按 button index 区分：0=关闭, 1=去更新
          if (res.index === 1) {
            jumpToAppMarket(getContext(this));
          }
        }).catch((e: Error): void => {
          Logger.w('SettingsPage', `update dialog failed: ${String(e)}`);
        });
      } else {
        promptAction.showToast({ message: t('settings.upToDate') });
      }
    } catch (e) {
      Logger.w('SettingsPage', `handleCheckUpdate failed: ${String(e)}`);
      promptAction.showToast({ message: t('common.operationFailed') });
    } finally {
      this.checkingUpdate = false;
    }
  }

  /**
   * 参与内测（对齐 mobile handleRedeemInternalTestCode）：
   * - 必须先登录 Plus 账号
   * - 已经开通 VIP 的提示无需重复
   * - 调用 plusApi.participateInternalTest 给账号 +1 个月 VIP
   * - 写回本地缓存并刷新 isPlusVip
   */
  private async handleJoinBeta(): Promise<void> {
    if (this.joiningBeta) return;
    try {
      const plusUserId: string | null = await kvStore.get('plus_user_id');
      if (!plusUserId || plusUserId.length === 0) {
        promptAction.showDialog({
          title: t('common.loginFirst'),
          message: t('settings.loginMemberFirst'),
          buttons: [{ text: t('common.ok'), color: this.theme.colors.primary }],
        }).catch(() => undefined);
        return;
      }
      const plusToken: string | null = await kvStore.get('plus_token');
      if (plusToken) setPlusAuthToken(plusToken);

      // 先查一次 VIP 状态，避免重复申请
      const me = await plusApi.getMe(plusUserId);
      if (me.vipTier && me.vipTier !== 'NONE') {
        promptAction.showToast({ message: t('settings.betaTestAlreadyHas') });
        return;
      }

      this.joiningBeta = true;
      const startsAt: Date = new Date();
      const endsAt: Date = new Date(startsAt);
      endsAt.setMonth(endsAt.getMonth() + 1);
      const result = await plusApi.participateInternalTest(
        startsAt.toISOString(),
        endsAt.toISOString(),
      );
      if (!result.ok) {
        throw new Error(t('settings.betaTestFailed'));
      }
      // 写回本地缓存（对齐 mobile AsyncStorage.setItem('plus_vip_status', 'true') 等）
      await kvStore.set('plus_vip_status', 'true');
      await kvStore.set('plus_vip_data', JSON.stringify({
        ok: result.ok,
        vipTier: result.vipTier ?? 'PLUS',
        vipStartsAt: result.vipStartsAt ?? startsAt.toISOString(),
        vipEndsAt: result.vipEndsAt ?? endsAt.toISOString(),
      }));
      await kvStore.set('plus_vip_updated_at', Date.now().toString());
      // 刷新本页 isPlusVip（如有 UI 依赖）；此处只 toast 提示成功
      promptAction.showDialog({
        title: t('settings.betaTestSuccess'),
        message: t('settings.betaTestSuccess'),
        buttons: [{ text: t('common.ok'), color: this.theme.colors.primary }],
      }).catch(() => undefined);
    } catch (e) {
      Logger.w('SettingsPage', `handleJoinBeta failed: ${String(e)}`);
      promptAction.showToast({
        message: e instanceof Error ? e.message : t('settings.betaTestFailed'),
      });
    } finally {
      this.joiningBeta = false;
    }
  }
}
