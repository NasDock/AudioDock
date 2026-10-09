import router from '@ohos.router';
import promptAction from '@ohos.promptAction';
import { kvStore } from 'features_storage';
import { t } from 'features_i18n';
import { Logger } from 'audiodock_common';
import { scanLoginApi, subscribeScanLoginSession } from 'features_network';
import type { ScanLoginSessionStatus, ScanLoginSelection, ScanLoginUnsubscribe } from 'features_network';
import { AppIcon, AppIconName } from '../components/AppIcon';
import { authStore } from '../context/AuthStore';
import { buildTheme } from 'features_ui';
import type { Theme, ThemeMode } from 'features_ui';

const TAG = 'ScanConfirmPage';

// ArkTS 严格模式不允许 Record 索引访问；用 class 显式表达。
class BundleItem {
  type: string = '';
  configId: string = '';
  name: string = '';
  internal: string = '';
  external: string = '';

  selected: boolean = false;
}

@Entry
@Component
struct ScanConfirmPage {
  @StorageLink('themeMode') @Watch('onThemeModeChange') themeMode: ThemeMode = 'light';
  @State theme: Theme = buildTheme('light');
  // 沉浸式避让区高度（vp，services/systemBar publishAvoidArea 下发）
  @StorageProp('statusBarHeightVp') statusBarHeightVp: number = 0;
  @StorageProp('navBarHeightVp') navBarHeightVp: number = 0;
  @StorageProp('appLang') appLang: string = 'zh-CN';

  @State sessionId: string = '';
  @State secret: string = '';
  @State status: ScanLoginSessionStatus | null = null;
  @State items: BundleItem[] = [];
  @State loading: boolean = true;
  @State confirming: boolean = false;
  @State errorMsg: string = '';

  private unsubscribe: ScanLoginUnsubscribe | null = null;

  aboutToAppear() {
    this.theme = buildTheme(this.themeMode);
    const params = router.getParams() as Record<string, Object> | undefined;
    if (params) {
      const sid = params['sessionId'];
      const sec = params['secret'];
      if (typeof sid === 'string') this.sessionId = sid;
      if (typeof sec === 'string') this.secret = sec;
    }
    if (this.sessionId.length === 0 || this.secret.length === 0) {
      promptAction.showDialog({
        title: t('common.error'),
        message: t('scanLogin.paramMissing'),
        buttons: [
          { text: t('scanLogin.back'), color: this.theme.colors.primary },
        ],
      }).then((): void => { router.back(); });
      return;
    }
    this.initSession();
  }

  aboutToDisappear() {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
  }

  onThemeModeChange(): void {
    this.theme = buildTheme(this.themeMode);
  }

  async initSession(): Promise<void> {
    try {
      const res = await scanLoginApi.getSession(this.sessionId, this.secret);
      this.status = res;
      this.items = this.flattenBundles(res);
      this.loading = false;
    } catch (e) {
      Logger.e(TAG, `getSession failed: ${String(e)}`);
      this.errorMsg = e instanceof Error ? e.message : String(e);
      this.loading = false;
      promptAction.showDialog({
        title: t('common.error'),
        message: t('scanLogin.fetchFailed'),
        buttons: [
          { text: t('scanLogin.back'), color: this.theme.colors.primary },
        ],
      }).then((): void => { router.back(); });
      return;
    }

    this.unsubscribe = subscribeScanLoginSession(this.sessionId, this.secret, (status): void => {
      this.status = status;
      if (status.status === 'success') {
        this.unsubscribe?.();
        this.unsubscribe = null;
        promptAction.showDialog({
          title: '',
          message: t('scanLogin.loginSuccess'),
          buttons: [
            { text: t('common.ok'), color: this.theme.colors.primary },
          ],
        }).then((): void => {
          router.replaceUrl({ url: 'pages/RootShellPage' });
        });
      } else if (status.status === 'failed' || status.status === 'expired') {
        this.unsubscribe?.();
        this.unsubscribe = null;
        promptAction.showDialog({
          title: '',
          message: t('scanLogin.loginFailed'),
          buttons: [
            { text: t('scanLogin.back'), color: this.theme.colors.primary },
          ],
        }).then((): void => { router.replaceUrl({ url: 'pages/RootShellPage' }); });
      }
    });
  }

  private flattenBundles(status: ScanLoginSessionStatus): BundleItem[] {
    const out: BundleItem[] = [];
    const bundles = status.sourceBundles ?? [];
    for (const bundle of bundles) {
      const configs = bundle.configs ?? [];
      for (const cfg of configs) {
        const item = new BundleItem();
        item.type = bundle.type;
        item.configId = cfg.id;
        item.name = cfg.name ?? t('scanLogin.unsupportedSourceEmpty');
        item.internal = cfg.internal;
        item.external = cfg.external;
        item.selected = true;
        out.push(item);
      }
    }
    return out;
  }

  toggleItem(item: BundleItem): void {
    for (let i = 0; i < this.items.length; i++) {
      if (this.items[i].configId === item.configId) {
        const next = new BundleItem();
        next.type = this.items[i].type;
        next.configId = this.items[i].configId;
        next.name = this.items[i].name;
        next.internal = this.items[i].internal;
        next.external = this.items[i].external;
        next.selected = !this.items[i].selected;
        this.items[i] = next;
        break;
      }
    }
  }

  private buildSelections(): ScanLoginSelection[] {
    const out: ScanLoginSelection[] = [];
    const group: Record<string, string[]> = {};
    for (const item of this.items) {
      if (!item.selected) continue;
      if (!group[item.type]) group[item.type] = [];
      group[item.type].push(item.configId);
    }
    const keys = Object.keys(group);
    for (const k of keys) {
      out.push({ type: k, configIds: group[k] });
    }
    return out;
  }

  async handleConfirm(): Promise<void> {
    if (this.confirming) return;
    this.confirming = true;
    try {
      const selections = this.buildSelections();
      await scanLoginApi.confirm(this.sessionId, this.secret, selections);
      // 保持 confirming=true；等待 success/failed 通过订阅回调处理
    } catch (e) {
      Logger.e(TAG, `confirm failed: ${String(e)}`);
      this.confirming = false;
      promptAction.showDialog({
        title: t('common.error'),
        message: t('scanLogin.confirmFailed'),
        buttons: [
          { text: t('common.ok'), color: this.theme.colors.textSecondary },
        ],
      });
    }
  }

  goBack(): void {
    router.back();
  }

  @Builder
  HeaderBar() {
    Row() {
      Button() {
        AppIcon({ name: 'close', iconSize: 24, color: this.theme.colors.text })
      }
      .width(40).height(40).backgroundColor(Color.Transparent)
      .onClick((): void => this.goBack())

      Text(t('scanLogin.confirmTitle'))
        .fontSize(18).fontWeight(FontWeight.Bold).fontColor(this.theme.colors.text)
        .layoutWeight(1).textAlign(TextAlign.Center)

      Row().width(40).height(40)
    }
    .width('100%').padding({ left: 15, right: 15, top: 16, bottom: 15 })
  }

  @Builder
  LoadingView() {
    Column() {
      LoadingProgress().width(40).height(40).color(this.theme.colors.primary)
    }
    .width('100%').layoutWeight(1)
    .justifyContent(FlexAlign.Center).alignItems(HorizontalAlign.Center)
  }

  @Builder
  BundleCard() {
    Scroll() {
      Column() {
        Text(t('scanLogin.confirmDesc'))
          .fontSize(14).fontColor(this.theme.colors.textSecondary)
          .padding({ left: 4, right: 4 })
          .margin({ bottom: 16 })

        if (this.items.length === 0) {
          Text(t('scanLogin.emptyBundles'))
            .fontSize(13).fontColor(this.theme.colors.textSecondary)
            .padding(20).textAlign(TextAlign.Center)
        }

        ForEach(this.items, (item: BundleItem) => {
          this.BundleRow(item)
        }, (item: BundleItem) => item.type + '-' + item.configId)

        Row() {
          if (this.confirming) {
            Row() {
              LoadingProgress().width(20).height(20).color(this.theme.colors.onPrimary)
            }
            .padding({ top: 10, bottom: 10, left: 24, right: 24 }).borderRadius(10)
            .backgroundColor(this.theme.colors.primary).opacity(0.7)
          } else {
            Row() {
              Text(t('scanLogin.confirmButton'))
                .fontSize(16).fontWeight(FontWeight.Bold).fontColor(this.theme.colors.onPrimary)
            }
            .padding({ top: 10, bottom: 10, left: 24, right: 24 }).borderRadius(10)
            .backgroundColor(this.theme.colors.primary)
            .onClick((): void => { this.handleConfirm(); })
          }
        }
        .width('100%').justifyContent(FlexAlign.Center).margin({ top: 24, bottom: 32 })
      }
      .width('100%')
    }
    .width('100%').layoutWeight(1)
    .scrollBar(BarState.Off).edgeEffect(EdgeEffect.Spring)
    .padding({ left: 20, right: 20, top: 12 })
  }

  @Builder
  BundleRow(item: BundleItem) {
    Column() {
      Row() {
        AppIcon({
          name: item.selected ? 'checkbox' : 'square-outline',
          iconSize: 22,
          color: item.selected ? this.theme.colors.primary : this.theme.colors.textSecondary,
        })
        Column() {
          Text(item.name)
            .fontSize(15).fontWeight(FontWeight.Medium).fontColor(this.theme.colors.text)
          Text(`${t('scanLogin.unsupportedSource')}${item.internal || t('scanLogin.unsupportedSourceEmpty')}`)
            .fontSize(12).fontColor(this.theme.colors.textSecondary).margin({ top: 2 })
          Text(`${t('scanLogin.unsupportedSourceExt')}${item.external || t('scanLogin.unsupportedSourceEmpty')}`)
            .fontSize(12).fontColor(this.theme.colors.textSecondary).margin({ top: 2 })
        }
        .layoutWeight(1).alignItems(HorizontalAlign.Start).margin({ left: 12 })
      }
      .width('100%').alignItems(VerticalAlign.Center)
      .padding(12)
    }
    .width('100%').margin({ bottom: 12 })
    .borderRadius(14)
    .border({ width: 1, color: this.theme.colors.border })
    .backgroundColor(this.theme.colors.surface)
    .onClick((): void => this.toggleItem(item))
  }

  build() {
    // 语言切换时重建整页
    // 沉浸式避让：全屏布局下页面从物理 y=0 排版，外层 Column padding 避开状态栏/小横条
    Column() {
      if (this.appLang === 'zh-CN') {
        this.LocalizedContent()
      } else {
        this.LocalizedContent()
      }
    }
    .width('100%').height('100%')
    .backgroundColor(this.theme.colors.background)
    .padding({ top: this.statusBarHeightVp, bottom: this.navBarHeightVp })
  }

  @Builder
  LocalizedContent() {
    Column() {
      this.HeaderBar()
      if (this.loading || this.status === null) {
        this.LoadingView()
      } else {
        this.BundleCard()
      }
    }
    .width('100%').height('100%').backgroundColor(this.theme.colors.background)
  }
}