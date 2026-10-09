import router from '@ohos.router';
import { kvStore } from 'features_storage';
import { buildTheme } from 'features_ui';
import type { Theme, ThemeMode } from 'features_ui';
import { t, getLang } from 'features_i18n';
import { getInternalQuality, getExternalQuality } from '../services/trackQuality';
import type { Quality } from '../services/trackQuality';

/**
 * AppStorage 中转参数类型：SettingsPage pushUrl 前写入，PlaybackQualityPage aboutToAppear 时读。
 * ArkTS 不允许在 AppStorage.get<...> 泛型里直接写内联对象字面量，必须先抽出顶层接口。
 */
interface PendingNetworkParam {
  network?: string;
}

class QualityOption {
  value: Quality = 'high';
  labelKey: string = '';
  descriptionKey: string = '';

  constructor(value: Quality, labelKey: string, descriptionKey: string) {
    this.value = value;
    this.labelKey = labelKey;
    this.descriptionKey = descriptionKey;
  }
}

@Entry
@Component
struct PlaybackQualityPage {
  @StorageLink('themeMode') @Watch('onThemeModeChange') themeMode: ThemeMode = 'light';
  @State private langAtBuild: string = getLang();
  @State theme: Theme = buildTheme('light');
  // 沉浸式避让区高度（vp，services/systemBar publishAvoidArea 下发）
  @StorageProp('statusBarHeightVp') statusBarHeightVp: number = 0;
  @StorageProp('navBarHeightVp') navBarHeightVp: number = 0;
  @State isInternal: boolean = true;
  @State selectedQuality: string = 'high';

  private options: QualityOption[] = [
    new QualityOption('lossless', 'settings.playbackQualityLossless', 'settings.playbackQualityLosslessDescription'),
    new QualityOption('high', 'settings.playbackQualityHigh', 'settings.playbackQualityHighDescription'),
    new QualityOption('standard', 'settings.playbackQualityLow', 'settings.playbackQualityLowDescription'),
  ];

  aboutToAppear(): void {
    this.theme = buildTheme(this.themeMode);
    // 历史 bug：aboutToAppear 阶段 router.getParams() 经常拿不到，导致 isInternal 一直是默认 true，
    // 用户点"外网播放品质"进去也会按内网读/写。
    // 改为：从 AppStorage 读 pendingPlaybackQuality（SettingsPage pushUrl 前写入）。
    // 兜底：从 router.getParams 也读一次（鸿蒙偶发能拿到）。
    const params = router.getParams() as PendingNetworkParam;
    if (params && typeof params.network === 'string') {
      this.isInternal = params.network === 'internal';
      AppStorage.setOrCreate<PendingNetworkParam>('pendingPlaybackQuality', { network: params.network });
    } else {
      const stored = AppStorage.get<PendingNetworkParam>('pendingPlaybackQuality');
      this.isInternal = (stored?.network ?? 'internal') === 'internal';
    }
    this.loadCurrent();
  }

  onThemeModeChange(): void {
    this.theme = buildTheme(this.themeMode);
  }

  async loadCurrent() {
    const q = this.isInternal ? await getInternalQuality() : await getExternalQuality();
    this.selectedQuality = q;
  }

  async handleSelect(quality: Quality) {
    const key = this.isInternal ? 'internalPlaybackQuality' : 'externalPlaybackQuality';
    await kvStore.set(key, quality);
    // 通知 SettingsPage 在 onPageShow 时重新读 KV 刷新右侧标签（历史 bug：直接 router.back 不通知，回显永远是旧值）
    AppStorage.setOrCreate('settingsPageShouldReload', true);
    router.back();
  }

  getTitle(): string {
    return this.isInternal
      ? t('settings.internalPlaybackQuality')
      : t('settings.externalPlaybackQuality');
  }

  onPageShow(): void {
    // 语言可能在后台（语言页/系统设置）被修改：回显时若语言已变化，切换 if 分支重建整页。
    // 不能在隐藏时重建——@StorageProp 在后台更新触发的重建会导致路由页触摸失效，
    // 因此用 langAtBuild 把重建延迟到页面可见时。
    const cur = getLang();
    if (cur !== this.langAtBuild) this.langAtBuild = cur;
  }

  build() {
    // 语言切换时重建整页：条件读取 langAtBuild 建立依赖（框架只追踪读取状态变量的表达式，
    // t() 是普通函数无法被追踪），语言变化使 if 分支切换，旧子树销毁、新子树重建，
    // 所有 t() 文案（含局部 @Builder 和 @Prop 传串的子组件）都按新语言重新求值。
    // 沉浸式避让：全屏布局下页面从物理 y=0 排版，外层 Column padding 避开状态栏/小横条
    Column() {
      if (this.langAtBuild === 'zh-CN') {
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
        .onClick((): void => router.back())

        Text(this.getTitle())
          .fontSize(18)
          .fontWeight(FontWeight.Medium)
          .fontColor(this.theme.colors.text)
          .layoutWeight(1)
          .textAlign(TextAlign.Center)

        Row().width(40).height(40)
      }
      .width('100%')
      .padding({ left: 20, right: 20, top: 16, bottom: 15 })

      // Quality options list
      Column() {
        ForEach(this.options, (option: QualityOption): void => {
          Row() {
            Column() {
              Text(t(option.labelKey))
                .fontSize(16)
                .fontWeight(FontWeight.Medium)
                .fontColor(this.theme.colors.text)
              Text(t(option.descriptionKey))
                .fontSize(13)
                .fontColor(this.theme.colors.textSecondary)
                .margin({ top: 4 })
            }
            .layoutWeight(1)
            .alignItems(HorizontalAlign.Start)
            .margin({ right: 16 })

            if (this.selectedQuality === option.value) {
              Text('✓')
                .fontSize(20)
                .fontWeight(FontWeight.Bold)
                .fontColor(this.theme.colors.primary)
            }
          }
          .width('100%')
          .padding({ top: 16, bottom: 16 })
          .borderWidth({ bottom: 0.5 })
          .borderColor(this.theme.colors.border)
          .onClick(() => this.handleSelect(option.value))
        }, (option: QualityOption): string => option.value)
      }
      .width('100%')
      .padding({ left: 20, right: 20 })
      .margin({ top: 10 })
    }
    .width('100%')
    .height('100%')
    .backgroundColor(this.theme.colors.background)
  }
}
