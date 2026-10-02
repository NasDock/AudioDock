import router from '@ohos.router';
import common from '@ohos.app.ability.common';
import { buildTheme } from 'features_ui';
import type { Theme, ThemeMode } from 'features_ui';
import { kvStore } from 'features_storage';
import { authStore } from '../context/AuthStore';
import { PrivacyAgreementDialog } from '../components/PrivacyAgreementDialog';
import hilog from '@ohos.hilog';

const DOMAIN = 0xA001;
const TAG = 'IndexRoute';

/** 与 mobile 的 PRIVACY_AGREEMENT_ACCEPTED_KEY 保持一致。 */
const PRIVACY_AGREEMENT_ACCEPTED_KEY = 'privacy_agreement_accepted';

@Entry
@Component
struct Index {
  @State showPrivacyDialog: boolean = false;
  @StorageLink('themeMode') @Watch('onThemeModeChange') themeMode: ThemeMode = 'light';
  @State theme: Theme = buildTheme('light');
  // 沉浸式避让区高度（vp，services/systemBar publishAvoidArea 下发）
  @StorageProp('statusBarHeightVp') statusBarHeightVp: number = 0;
  @StorageProp('navBarHeightVp') navBarHeightVp: number = 0;

  onThemeModeChange(): void {
    this.theme = buildTheme(this.themeMode);
  }

  async aboutToAppear(): Promise<void> {
    hilog.info(DOMAIN, TAG, '[1] aboutToAppear entered');
    this.theme = buildTheme(this.themeMode);
    try {
      // 防御性初始化：框架可能在 EntryAbility 的异步 initialize() 完成 kvStore.init
      // 之前就加载本页，导致读取命中空的内存兜底、每次重启都误入数据源选择页。
      await kvStore.init(getContext(this) as common.UIAbilityContext);
    } catch (e) {
      hilog.warn(DOMAIN, TAG, `[1.5] kvStore.init: ${String(e)}`);
    }
    try {
      await authStore.loadFromStorage();
      hilog.info(DOMAIN, TAG, `[2] loadFromStorage done user=${String(authStore.state_.user)} server=${authStore.state_.serverAddress} token=${authStore.state_.token ? 'yes' : 'no'}`);
    } catch (e) {
      hilog.error(DOMAIN, TAG, `[2] loadFromStorage THREW: ${String(e)}`);
    }
    setTimeout(() => {
      hilog.info(DOMAIN, TAG, '[3] setTimeout fired');
      this.checkPrivacyAndNavigate();
    }, 0);
  }

  /** 首次启动且未同意过协议时先弹隐私协议弹窗，同意后再跳转（1:1 mobile 行为）。 */
  private async checkPrivacyAndNavigate(): Promise<void> {
    let accepted = '';
    try {
      const v = await kvStore.get(PRIVACY_AGREEMENT_ACCEPTED_KEY);
      accepted = v ?? '';
    } catch (e) {
      hilog.warn(DOMAIN, TAG, `[3.5] read privacy flag failed: ${String(e)}`);
    }
    if (accepted !== 'true') {
      hilog.info(DOMAIN, TAG, '[3.6] privacy not accepted, show dialog');
      this.showPrivacyDialog = true;
      return;
    }
    this.navigateByAuth();
  }

  private navigateByAuth(): void {
    let target = 'pages/SourceSelectPage';
    if (authStore.state_.token && authStore.state_.serverAddress) target = 'pages/RootShellPage';
    else if (authStore.state_.serverAddress) target = 'pages/LoginPage';
    hilog.info(DOMAIN, TAG, `[4] navigating to ${target}`);
    router.replaceUrl({ url: target }).then(() => {
      hilog.info(DOMAIN, TAG, `[5] replaceUrl resolved for ${target}`);
    }).catch((e: Error) => {
      hilog.error(DOMAIN, TAG, `[5] replaceUrl REJECTED for ${target}: ${e.message}`);
    });
  }

  private onAgree(): void {
    kvStore.set(PRIVACY_AGREEMENT_ACCEPTED_KEY, 'true').catch((e: Error) => {
      hilog.warn(DOMAIN, TAG, `save privacy flag failed: ${e.message}`);
    });
    this.showPrivacyDialog = false;
    this.navigateByAuth();
  }

  private onDisagree(): void {
    (getContext(this) as common.UIAbilityContext).terminateSelf();
  }

  /** 弹窗展示期间拦截返回键：用户必须明确选择"同意并继续"或"不同意"。 */
  onBackPress(): boolean {
    return this.showPrivacyDialog;
  }

  build() {
    Stack() {
      Column() { Text('AudioDock').fontSize(28).fontWeight(700); }
        .width('100%').height('100%').justifyContent(FlexAlign.Center);

      if (this.showPrivacyDialog) {
        Column() {
          PrivacyAgreementDialog({
            theme: this.theme,
            onAgree: (): void => this.onAgree(),
            onDisagree: (): void => this.onDisagree(),
          })
        }
        .width('100%')
        .height('100%')
        .padding({ left: 32, right: 32 })
        .backgroundColor('rgba(0,0,0,0.5)')
        .justifyContent(FlexAlign.Center)
        .alignItems(HorizontalAlign.Center)
        .onClick(() => {
          // 拦截点击穿透：用户必须通过按钮做出明确选择
        });
      }
    }
    .width('100%')
    .height('100%')
    .backgroundColor(this.theme.colors.background)
    // 沉浸式避让：全屏布局下页面从物理 y=0 排版，根容器 padding 避开状态栏/小横条
    .padding({ top: this.statusBarHeightVp, bottom: this.navBarHeightVp })
  }
}
