import UIAbility from '@ohos.app.ability.UIAbility';
import AbilityConstant from '@ohos.app.ability.AbilityConstant';
import hilog from '@ohos.hilog';
import Want from '@ohos.app.ability.Want';
import { window } from '@kit.ArkUI';
import router from '@ohos.router';
import { bundleManager, ConfigurationConstant, Configuration } from '@kit.AbilityKit';
import { Logger, getSelfBundleInfo, getSelfAppVersion } from 'audiodock_common';
import { kvStore, fileCache, rdbStore } from 'features_storage';
import { httpClient } from 'features_network';
import { applySetting } from 'features_i18n';
import { type ThemeMode } from 'features_ui';
import { installPlaybackService } from '../services/playbackService';
import { installAVSessionService, releaseAVSessionService } from '../services/avSessionService';
import { setSystemBarWindow, applySystemBar } from '../services/systemBar';
import { themeAutoStore } from '../context/ThemeAutoStore';
import { authStore } from '../context/AuthStore';
import { refreshNetworkMode } from '../utils/networkMode';
import { installWechatRespHandler, registerWechatApp, handleWechatWant } from '../services/WechatPayService';
import { widgetBridge } from '../services/WidgetBridge';
import { widgetCommandHandler } from '../services/WidgetCommandHandler';
import { playerStore } from '../context/PlayerStore';
import { rpc } from '@kit.IPCKit';
import { BusinessError } from '@kit.BasicServicesKit';

/** Bundle信息摘要接口 */
interface BundleInfoSummary {
  name: string;
  versionName: string;
  versionCode: number;
  hapModules: string[];
  permissions: string[];
  appId?: string;
  hasSignature: boolean;
}

const DOMAIN = 0xA001;
const TAG = 'EntryAbility';

// 微信开放平台为 AudioDock 申请的 AppID（mobile 端 member-benefits.tsx 里的 WECHAT_APP_ID
// 是 mock 占位未真正使用）。这里必须用真实 AppID，否则 SDK 注册会被微信服务器拒绝（errCode=-1）。
const WECHAT_APP_ID = 'wx42a4102d85be55a1';

export default class EntryAbility extends UIAbility {
  private initPromise: Promise<void> | null = null;
  /**
   * playerStore.restoreState 的 Promise（MainPage.aboutToAppear 完成后 resolve）。
   * 卡片 call 事件冷启动主 App 时，指令会在 MainPage 恢复状态之前到达，
   * 必须等恢复完成再执行，否则 queue 是空的，play/pause 全部落空。
   */
  private restorePromise: Promise<void> | null = null;

  async onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): Promise<void> {
    hilog.info(DOMAIN, TAG, `onCreate launchParam=${launchParam}`);
    Logger.i(TAG, 'onCreate');
    this.initPromise = this.initialize();
    await this.initPromise;
    // 微信支付 SDK 注册（AppID 必须在 SDK 调起前注册，否则 sendReq 会失败）。
    // 必须放在 onCreate 里、installPlaybackService 之前，确保 SDK 在用户首次支付时已就绪。
    installWechatRespHandler();
    registerWechatApp(WECHAT_APP_ID);
    // 冷启动时微信可能已通过 scheme 回跳（want 里带回调数据），注册完立即透传给 SDK。
    handleWechatWant(want);
    installPlaybackService();
    try {
      await installAVSessionService(this.context);
    } catch (e) {
      Logger.w(TAG, `install AVSession: ${String(e)}`);
    }

    // ===== 桌面小部件 call 事件（对齐官方 CardInfoRefresh 示例）=====
    // 卡片 postCardAction(action='call', abilityName='EntryAbility', params={method, id})
    // 会触发本进程冷/热启动 + 走 this.callee 回调，由主 App 直接执行 playerStore 指令，
    // 然后由 PlayerStore.notify → WidgetBridge.scheduleSyncNowPlaying 自动回推 updateForm。
    // 这比 message 事件（落到 EntryFormAbility 进程）可靠 —— 播控指令必须作用在主 App 的
    // playerStore 单例上，否则会启动第二个播放实例。
    this.registerWidgetCallHandlers();

    // ===== 桌面小部件数据推送 =====
    // 订阅 playerStore / likesHistory 变化 → 写 kvStore + formProvider.updateForm
    widgetBridge.install();
    // 冷启动时立即恢复上次播放状态（不等 MainPage），
    // 让卡片 call 事件到达时 queue 已经有值，play/pause 能真正生效。
    this.restorePromise = playerStore.restoreState().catch((e: Error): void => {
      Logger.w(TAG, `restoreState: ${e.message}`);
    });
    // 拉一次 VIP / 歌单 / 历史 / 上新（不阻塞主流程，失败仅 warn）
    widgetBridge.refreshAll().catch((e: Error): void => {
      Logger.w(TAG, `widgetBridge.refreshAll: ${e.message}`);
    });

    // ===== 接口落点探测（debug only）=====
    // 通过 bundleManager.getBundleInfoForSelf 验证 common/audiodock_common 工具函数链路通到 entry。
    // fire-and-forget，不阻塞冷启动；失败仅打日志，不影响业务流程。
    this.dumpSelfBundleInfo();

    // 处理桌面小部件拉起的深链（audiodock://widget/...）
    this.handleWidgetDeepLink(want);

    this.loadPage('pages/Index');
  }

  /**
   * 注册桌面小部件 call 事件回调（对齐官方 CardInfoRefresh 示例的
   * this.callee.on('updateCardInfo', ...) / this.callee.on('updateFormFavour', ...)）。
   *
   * 卡片侧 postCardAction({ action: 'call', abilityName: 'EntryAbility',
   * params: { method: 'play' | 'pause' | 'next' | 'prev' | 'mode' | 'like' | 'unlike', id? } })
   *
   * call 事件由系统直接拉起 EntryAbility 并执行本回调（即使主 App 未运行），
   * 指令直接作用在主 App 的 playerStore 单例上 —— 这是控制音频播放唯一正确的进程。
   */
  private registerWidgetCallHandlers(): void {
    const handler = (data: rpc.MessageSequence): WidgetParcelable => {
      try {
        const params: Record<string, string> = JSON.parse(data.readString());
        // 卡片侧 params 结构：{ method: 'widgetCommand', widgetAction: 'play'|'pause'|..., id?: '' }
        // method 是固定入口名（系统 call 事件按 ability 级注册，不区分 method），
        // 真实指令在 widgetAction 字段。
        const action: string = params['widgetAction'] ?? '';
        const id: string = params['id'] ?? '';
        Logger.i(TAG, `widget call: action=${action} id=${id}`);
        if (action !== '') {
          const payload: Record<string, string> = {};
          if (id !== '') payload['id'] = id;
          // 冷启动时先等 restoreState 完成（queue 恢复），否则 play/pause 会落空。
          // fire-and-forget：指令执行是异步的，完成后由 playerStore.notify →
          // widgetBridge.scheduleSyncNowPlaying 自动把最新状态推回卡片。
          const exec = async (): Promise<void> => {
            if (this.restorePromise) await this.restorePromise;
            await widgetCommandHandler.handle({ action, payload });
          };
          exec().catch((e: Error): void => {
            Logger.w(TAG, `widget call ${action}: ${e.message}`);
          });
        }
      } catch (e) {
        const err = e as BusinessError;
        Logger.e(TAG, `widget call parse failed: code=${err.code} msg=${err.message}`);
      }
      return new WidgetParcelable(0);
    };
    try {
      this.callee.on('widgetCommand', handler);
      Logger.i(TAG, 'widget call handler registered');
    } catch (e) {
      const err = e as BusinessError;
      Logger.e(TAG, `callee.on widgetCommand failed: code=${err.code} msg=${err.message}`);
    }
  }

  /**
   * 微信支付完成后会通过 scheme `wx42a4102d85be55a1://platformId=wechat` 重新拉起本 Ability。
   * SDK 1.0.10+ 用 openLink 拉起微信，回调通过 onNewWant 触发；必须在这里透传给 SDK。
   */
  onNewWant(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    Logger.i(TAG, `onNewWant uri=${want.uri}`);
    handleWechatWant(want);
    this.handleWidgetDeepLink(want);
  }

  /**
   * 回到前台时重设系统栏/窗口底色。
   * 切后台瞬间系统可能用启动白底生成任务卡片快照（闪白），
   * 回前台重设可确保窗口底色与状态栏颜色始终跟随当前主题。
   */
  onForeground(): void {
    const mode: ThemeMode = AppStorage.get<ThemeMode>('themeMode') ?? 'light';
    applySystemBar(mode);
  }

  onDestroy(): void {
    Logger.i(TAG, 'onDestroy');
    themeAutoStore.stop();
    releaseAVSessionService();
    // 注销卡片 call 事件（对齐官方示例 onDestroy）
    try {
      this.callee.off('widgetCommand');
    } catch (e) { /* swallow */ }
  }

  /**
   * 系统配置变更回调（含系统色 light/dark 切换）。
   * ThemeAutoStore.onSystemColorChanged 内部会校验 autoTheme 开关是否开启，
   * 关闭时自动停止覆盖 themeMode（保留用户手动选择）。
   */
  onConfigurationUpdate(newConfig: Configuration): void {
    Logger.i(TAG, `onConfigurationUpdate colorMode=${newConfig.colorMode}`);
    themeAutoStore.onSystemColorChanged(newConfig.colorMode);
  }

  async onWindowStageCreate(windowStage: window.WindowStage): Promise<void> {
    hilog.info(DOMAIN, TAG, 'onWindowStageCreate');
    // 系统不会等 async onCreate 结束就回调本方法；必须等初始化（语言/主题写入 AppStorage）
    // 完成后再加载页面，否则首帧会用默认中文构建，且 tabBar 等一次性构建的 UI 之后不再刷新。
    if (this.initPromise) await this.initPromise;

    // 先 loadContent 让页面尽快渲染；系统栏设置在 getMainWindow 回调里异步完成。
    // setSystemBarWindow 内部会开启沉浸式（setWindowLayoutFullScreen），
    // 之后 applySystemBar 才能真正改变状态栏/底部小横条区域颜色。
    windowStage.loadContent('pages/Index', (err: Error) => {
      if (err) Logger.e(TAG, `loadContent: ${err.message}`);
    });
    windowStage.getMainWindow().then((win: window.Window) => {
      setSystemBarWindow(win);
      const mode: ThemeMode = AppStorage.get<ThemeMode>('themeMode') ?? 'light';
      applySystemBar(mode);
    }).catch((e: Error) => Logger.w(TAG, `getMainWindow: ${e.message}`));
  }

  private async initialize(): Promise<void> {
    const ctx = this.context;
    // 供无 UI 的 service 类（WidgetBridge 封面落盘等）拿到 filesDir。
    // getContext() 只在 @Component 内可靠，service 必须从 AppStorage 取。
    AppStorage.setOrCreate('abilityContext', ctx);
    await kvStore.init(ctx);
    await fileCache.init(ctx);
    await rdbStore.init(ctx);

    const stored = await kvStore.get('serverAddress');
    if (stored) httpClient.setBaseURL(stored);
    const token = await kvStore.get(`token_${stored ?? ''}`);
    if (token) httpClient.setAuthToken(token);

    // 服务器地址确定后才能判定内网/外网，封面与头像的分级加载依赖它
    await refreshNetworkMode();

    const langSetting = await kvStore.get('app_language');
    if (langSetting === 'zh-CN' || langSetting === 'en') applySetting(langSetting);
    else applySetting('system');

    // 恢复用户选择的主题模式，供各页面 @StorageLink('themeMode') 响应
    const themeMode = await kvStore.get('themeMode');
    if (themeMode === 'light' || themeMode === 'dark' || themeMode === 'festive') {
      AppStorage.setOrCreate('themeMode', themeMode);
    }

    // 恢复内容模式（音乐/有声书），供首页/声仓 @StorageLink('playMode') 跨页签同步
    const savedPlayMode = await kvStore.get('playMode');
    AppStorage.setOrCreate('playMode', savedPlayMode === 'AUDIOBOOK' ? 'AUDIOBOOK' : 'MUSIC');

    // 恢复车机模式相关状态，供 MainPage / SettingsPage / GlobalBottomBar / SquirrelAgent
    // 通过 @StorageLink 订阅，跨页面联动（对齐 mobile 的 SettingsContext）。
    // carModeEnabled / carPanelsSwapped 用 'true'/'false' 字符串持久化；
    // screenBottomInset 是数字 0–160，用 String() 后再 Number() 解析。
    const carModeRaw = await kvStore.get('carModeEnabled');
    AppStorage.setOrCreate<boolean>('carModeEnabled', carModeRaw === 'true');
    const carPanelsSwappedRaw = await kvStore.get('carPanelsSwapped');
    AppStorage.setOrCreate<boolean>('carPanelsSwapped', carPanelsSwappedRaw === 'true');
    const screenInsetRaw = await kvStore.get('screenBottomInset');
    const inset = screenInsetRaw !== null ? Number(screenInsetRaw) : 0;
    AppStorage.setOrCreate<number>('screenBottomInset', Number.isFinite(inset) ? inset : 0);
    // 自动横竖屏：MainPage.applyOrientation 通过 @StorageLink 订阅，按优先级链决定方向
    const autoOrientRaw = await kvStore.get('autoOrientation');
    AppStorage.setOrCreate<boolean>('autoOrientation', autoOrientRaw === 'true');

    // 自动主题：把 kvStore 的 autoTheme 写入 AppStorage。
    // ThemeAutoStore 通过 EntryAbility.onConfigurationUpdate 回调接收系统色变化，
    // 这比 Web mediaquery 更可靠——是 HarmonyOS 系统级标准回调。
    const autoThemeRaw = await kvStore.get('autoTheme');
    AppStorage.setOrCreate<boolean>('autoTheme', autoThemeRaw === 'true');
    themeAutoStore.init(ctx);
    themeAutoStore.restore();

    // 恢复登录态（user/token），桌面小部件 syncVip 依赖 authStore.state_.user?.id，
    // 没这一步 syncVip 会因为 user=null 把 KV 写成 isVip=false，导致卡片被误锁定。
    await authStore.loadFromStorage();

    Logger.i(TAG, 'initialize complete');
  }

  private loadPage(path: string): void {
    hilog.info(DOMAIN, TAG, `would navigate to ${path}`);
  }

  /**
   * 接口落点探测：从 audiodock_common 调用 bundleManager.getBundleInfoForSelf 并打印摘要。
   * 仅 debug 阶段使用，提交前可注释或加 release 开关。
   */
  private dumpSelfBundleInfo(): void {
    getSelfAppVersion()
      .then((v) => {
        Logger.i(TAG, `[bundleInfo] version=${v.versionName} (code=${v.versionCode})`);
      })
      .catch((e: Error) => Logger.w(TAG, `[bundleInfo] version failed: ${e.message}`));

    getSelfBundleInfo()
      .then((info: bundleManager.BundleInfo) => {
        const summary: BundleInfoSummary = {
          name: info.name,
          versionName: info.versionName,
          versionCode: info.versionCode,
          hapModules: (info.hapModulesInfo ?? []).map((m: bundleManager.HapModuleInfo) => m.name),
          permissions: (info.reqPermissionDetails ?? []).map((p: bundleManager.ReqPermissionDetail) => p.name),
          appId: info.appInfo?.name,
          hasSignature: !!info.signatureInfo?.fingerprint,
        };
        Logger.i(TAG, `[bundleInfo] full=${JSON.stringify(summary)}`);
        // 应用签名证书的 SHA-256 指纹（微信开放平台「应用签名」要填的就是它，去掉冒号转大写）
        Logger.i(TAG, `[bundleInfo] signFingerprint=${JSON.stringify(info.signatureInfo?.fingerprint ?? 'NONE')}`);
      })
      .catch((e: Error) => Logger.w(TAG, `[bundleInfo] full failed: ${e.message}`));
  }

  /**
   * 处理桌面小部件拉起的深链：audiodock://widget/<path>
   * - member-benefits → MemberBenefitsPage
   * - player → MainPage（播放页路由由 RootShellPage 处理）
   * - method=<action>&id=<id> → widgetCommandHandler.handle 转发到 playerStore/likesHistory
   */
  private handleWidgetDeepLink(want: Want): void {
    const uri = want.uri;
    if (!uri) return;
    if (!uri.startsWith('audiodock://')) return;
    Logger.i(TAG, `widget deepLink: ${uri}`);
    // card 点击 url 是 audiodock://widget?method=play 这种带 params 的形式（postCardAction router+params）
    const params = (want.parameters as Record<string, Object>) ?? {};
    const methodVal = String(params['method'] ?? '');
    if (methodVal !== '') {
      const payload: Record<string, string> = {};
      payload['id'] = String(params['id'] ?? '');
      widgetCommandHandler.handle({
        action: methodVal,
        payload,
      }).catch((e: Error): void => {
        Logger.w(TAG, `widget command: ${e.message}`);
      });
      return;
    }
    // 直接 URL 形式：audiodock://widget/member-benefits（暂只用来跳会员页）
    const path = uri.replace('audiodock://', '');
    if (path.includes('member-benefits')) {
      try {
        router.pushUrl({ url: 'pages/MemberBenefitsPage' }).catch((): void => undefined);
      } catch (e) { /* swallow */ }
    }
  }
}

/**
 * call 事件回包（对齐官方 CardInfoRefresh 的 MyParcelable）。
 * 系统要求 callee 回调必须返回一个 rpc.Parcelable，内容不重要但格式必须正确。
 */
class WidgetParcelable implements rpc.Parcelable {
  num: number;
  constructor(num: number) {
    this.num = num;
  }
  marshalling(dataOut: rpc.MessageSequence): boolean {
    try {
      dataOut.writeInt(this.num);
    } catch (e) {
      const err = e as BusinessError;
      Logger.e('WidgetParcelable', `marshalling failed: ${err.code} ${err.message}`);
    }
    return true;
  }
  unmarshalling(dataIn: rpc.MessageSequence): boolean {
    try {
      this.num = dataIn.readInt();
    } catch (e) {
      const err = e as BusinessError;
      Logger.e('WidgetParcelable', `unmarshalling failed: ${err.code} ${err.message}`);
    }
    return true;
  }
}
