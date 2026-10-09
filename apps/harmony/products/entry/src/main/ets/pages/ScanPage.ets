import router from '@ohos.router';
import promptAction from '@ohos.promptAction';
import { abilityAccessCtrl, common } from '@kit.AbilityKit';
import { scanBarcode, scanCore } from '@kit.ScanKit';
import { BusinessError } from '@kit.BasicServicesKit';
import bundleManager from '@ohos.bundle.bundleManager';
import { kvStore } from 'features_storage';
import { t } from 'features_i18n';
import { Logger } from 'audiodock_common';
import { scanLoginApi } from 'features_network';
import type { ScanLoginClaimPayload, ScanLoginAuthBundle, ScanLoginPlusBundle } from 'features_network';
import { authStore } from '../context/AuthStore';
import { AppIcon } from '../components/AppIcon';
import { buildTheme } from 'features_ui';
import type { Theme, ThemeMode } from 'features_ui';

const TAG = 'ScanPage';

interface ParsedQR {
  sessionId: string;
  secret: string;
}

function parseScanLoginQR(text: string): ParsedQR | null {
  try {
    const obj: Record<string, string> = JSON.parse(text) as Record<string, string>;
    if (obj['kind'] !== 'soundx-scan-login') return null;
    const sid = obj['sessionId'];
    const sec = obj['secret'];
    if (typeof sid !== 'string' || typeof sec !== 'string') return null;
    if (sid.length === 0 || sec.length === 0) return null;
    return { sessionId: sid, secret: sec };
  } catch {
    return null;
  }
}

// 设备是否支持 ScanKit（HarmonyOS 4.0+ 大部分机型支持）
const SCAN_KIT_SUPPORTED: boolean = canIUse('SystemCapability.Multimedia.Scan.ScanBarcode');

/**
 * 扫码登录页（VIP 功能）。
 *
 * 对齐 mobile app/scan.tsx 流程：
 *   1) 进入页面检查相机权限；
 *   2) 无权限 → 显示引导页 + "去扫码"按钮，点击申请权限；
 *   3) 已授权 → 拉起 ScanKit 系统扫码界面（Default View 模式）；
 *   4) 扫到二维码 → 解析 {kind, sessionId, secret} → 调 claim 接口；
 *   5) 跳 ScanConfirmPage 完成后续确认。
 *
 * 历史实现：因未引入 ScanKit 写过一段"手动输入 sessionId/secret" 的回退方案。
 * 当前 targetAPIVersion=19 已具备 ScanKit 默认界面能力，移除非必要的兜底。
 */
@Entry
@Component
struct ScanPage {
  @StorageLink('themeMode') @Watch('onThemeModeChange') themeMode: ThemeMode = 'light';
  @State theme: Theme = buildTheme('light');
  // 沉浸式避让区高度（vp，services/systemBar publishAvoidArea 下发）
  @StorageProp('statusBarHeightVp') statusBarHeightVp: number = 0;
  @StorageProp('navBarHeightVp') navBarHeightVp: number = 0;
  @State permissionGranted: boolean = false;
  @State checkingPermission: boolean = true;
  @State busy: boolean = false;
  @State unsupportedDevice: boolean = !SCAN_KIT_SUPPORTED;

  // 本机 accessTokenId，用于 checkAccessTokenSync 检测自身权限
  private tokenId: number = 0;

  aboutToAppear() {
    this.theme = buildTheme(this.themeMode);
    this.tokenId = this.fetchTokenId();
    this.checkCameraPermission();
  }

  private fetchTokenId(): number {
    try {
      const bundleInfo: bundleManager.BundleInfo = bundleManager.getBundleInfoForSelfSync(
        bundleManager.BundleFlag.GET_BUNDLE_INFO_WITH_APPLICATION,
      );
      return bundleInfo.appInfo.accessTokenId;
    } catch (e) {
      Logger.w(TAG, `fetchTokenId failed: ${String(e)}`);
      return 0;
    }
  }

  onThemeModeChange(): void {
    this.theme = buildTheme(this.themeMode);
  }

  // ─────────────── 权限 ───────────────

  private getContext(): common.UIAbilityContext {
    return getContext(this) as common.UIAbilityContext;
  }

  private checkCameraPermission(): void {
    if (this.unsupportedDevice) {
      this.checkingPermission = false;
      return;
    }
    try {
      const atManager = abilityAccessCtrl.createAtManager();
      const grant: abilityAccessCtrl.GrantStatus = atManager.checkAccessTokenSync(
        this.tokenId,
        'ohos.permission.CAMERA',
      );
      this.permissionGranted = grant === abilityAccessCtrl.GrantStatus.PERMISSION_GRANTED;
    } catch (e) {
      Logger.w(TAG, `checkCameraPermission failed: ${String(e)}`);
      this.permissionGranted = false;
    } finally {
      this.checkingPermission = false;
      if (this.permissionGranted) {
        // 已有权限，进入页面立即拉起扫码，避免"授权后还要再点一次"
        this.startScan();
      }
    }
  }

  private async requestCameraPermission(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const atManager = abilityAccessCtrl.createAtManager();
      const result = await atManager.requestPermissionsFromUser(
        this.getContext(),
        ['ohos.permission.CAMERA'],
      );
      const grantArr: number[] = result.authResults ?? [];
      const granted: boolean = grantArr.length > 0 && grantArr[0] === abilityAccessCtrl.GrantStatus.PERMISSION_GRANTED;
      this.permissionGranted = granted;
      if (granted) {
        this.startScan();
      } else {
        promptAction.showToast({ message: t('scanLogin.permissionDenied') });
      }
    } catch (e) {
      Logger.e(TAG, `requestCameraPermission failed: ${String(e)}`);
      promptAction.showToast({ message: t('scanLogin.permissionDenied') });
    } finally {
      this.busy = false;
    }
  }

  // ─────────────── 扫码流程 ───────────────

  private async startScan(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const options: scanBarcode.ScanOptions = {
        scanTypes: [scanCore.ScanType.QR_CODE],
        enableMultiMode: false,
        enableAlbum: true,
      };
      const result: scanBarcode.ScanResult = await scanBarcode.startScanForResult(this.getContext(), options);
      const original: string = result.originalValue ?? '';
      if (original.length === 0) {
        promptAction.showToast({ message: t('scanLogin.invalidQR') });
        return;
      }
      await this.handleScannedText(original);
    } catch (e) {
      const err = e as BusinessError;
      // 201 = 用户取消扫描（ScanKit 标准错误码），不弹错误
      if (err && err.code === 201) {
        return;
      }
      Logger.e(TAG, `startScan failed: ${String(e)}`);
      promptAction.showToast({ message: t('scanLogin.scanFailed') });
    } finally {
      this.busy = false;
    }
  }

  private async handleScannedText(text: string): Promise<void> {
    const parsed: ParsedQR | null = parseScanLoginQR(text);
    if (!parsed) {
      promptAction.showToast({ message: t('scanLogin.invalidQR') });
      return;
    }
    try {
      const payload: ScanLoginClaimPayload = await this.buildClaimPayload();
      if (!payload.nativeAuth && !payload.plusAuth) {
        promptAction.showToast({ message: t('scanLogin.noLocalAuth') });
        return;
      }
      await scanLoginApi.claim(parsed.sessionId, parsed.secret, payload);
      router.replaceUrl({
        url: 'pages/ScanConfirmPage',
        params: { sessionId: parsed.sessionId, secret: parsed.secret },
      });
    } catch (e) {
      Logger.e(TAG, `claim failed: ${String(e)}`);
      promptAction.showToast({ message: t('scanLogin.scanFailed') });
    }
  }

  private async buildClaimPayload(): Promise<ScanLoginClaimPayload> {
    const payload: ScanLoginClaimPayload = {
      nativeAuth: null,
      plusAuth: null,
      sourceBundles: [],
    };
    const native: ScanLoginAuthBundle | null = this.buildNativeAuth();
    if (native) payload.nativeAuth = native;
    const plus: ScanLoginPlusBundle | null = await this.buildPlusAuth();
    if (plus) payload.plusAuth = plus;
    return payload;
  }

  private buildNativeAuth(): ScanLoginAuthBundle | null {
    const state = authStore.state_;
    const authMe = state.user;
    const token = state.token ?? '';
    if (!authMe || token.length === 0) return null;
    return {
      baseUrl: state.serverAddress,
      sourceType: state.sourceType,
      token: token,
      user: {
        id: authMe.id,
        username: authMe.username,
        nickname: authMe.nickname,
        avatar: authMe.avatar,
      },
    };
  }

  private async buildPlusAuth(): Promise<ScanLoginPlusBundle | null> {
    const token: string | null = await kvStore.get('plus_token');
    const userId: string | null = await kvStore.get('plus_user_id');
    if (!token || !userId) return null;
    return { token, userId };
  }

  // ─────────────── UI ───────────────

  goBack(): void {
    router.back();
  }

  @Builder
  HeaderBar() {
    Row() {
      Button() {
        AppIcon({ name: 'chevron-back', iconSize: 24, color: this.theme.colors.text })
      }
      .width(40).height(40).backgroundColor(Color.Transparent)
      .onClick((): void => { this.goBack(); })

      Text(t('scanLogin.title'))
        .fontSize(18).fontWeight(FontWeight.Bold).fontColor(this.theme.colors.text)
        .layoutWeight(1).textAlign(TextAlign.Center)

      Row().width(40).height(40)
    }
    .width('100%').padding({ left: 15, right: 15, top: 16, bottom: 15 })
  }

  @Builder
  PermissionGate() {
    // 没权限 / 设备不支持 → 显示引导页 + 按钮
    Column({ space: 16 }) {
      AppIcon({ name: 'scan', iconSize: 56, color: this.theme.colors.primary })
      Text(t('scanLogin.title'))
        .fontSize(20).fontWeight(FontWeight.Bold).fontColor(this.theme.colors.text)
      Text(t('scanLogin.permissionDesc'))
        .fontSize(14).fontColor(this.theme.colors.textSecondary)
        .textAlign(TextAlign.Center)
        .padding({ left: 24, right: 24 })
      Text(t('scanLogin.aimHint'))
        .fontSize(13).fontColor(this.theme.colors.textSecondary)
        .textAlign(TextAlign.Center)
        .padding({ left: 24, right: 24 })

      if (this.unsupportedDevice) {
        Text(t('scanLogin.unsupportedDevice'))
          .fontSize(13).fontColor(this.theme.colors.textSecondary)
          .textAlign(TextAlign.Center)
          .padding({ left: 24, right: 24 })
      } else {
        Button(t('scanLogin.grantPermission'))
          .width('70%').height(48)
          .backgroundColor(this.theme.colors.primary)
          .fontColor(this.theme.colors.onPrimary)
          .fontSize(16).fontWeight(FontWeight.Medium)
          .borderRadius(12)
          .enabled(!this.busy)
          .opacity(this.busy ? 0.5 : 1)
          .onClick((): void => { this.requestCameraPermission(); })
      }
    }
    .width('100%').layoutWeight(1)
    .justifyContent(FlexAlign.Center).alignItems(HorizontalAlign.Center)
  }

  @Builder
  AuthorizingHint() {
    Column({ space: 12 }) {
      LoadingProgress().width(32).height(32).color(this.theme.colors.primary)
      Text(t('common.loading')).fontSize(14).fontColor(this.theme.colors.textSecondary)
    }
    .width('100%').layoutWeight(1)
    .justifyContent(FlexAlign.Center).alignItems(HorizontalAlign.Center)
  }

  build() {
    Column() {
      this.HeaderBar()
      if (this.checkingPermission) {
        this.AuthorizingHint()
      } else {
        this.PermissionGate()
      }
    }
    .width('100%').height('100%').backgroundColor(this.theme.colors.background)
    // 沉浸式避让：全屏布局下页面从物理 y=0 排版，根容器 padding 避开状态栏/小横条
    .padding({ top: this.statusBarHeightVp, bottom: this.navBarHeightVp })
  }
}
