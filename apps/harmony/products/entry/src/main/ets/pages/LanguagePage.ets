import router from '@ohos.router';
import { kvStore } from 'features_storage';
import { buildTheme } from 'features_ui';
import type { Theme, ThemeMode } from 'features_ui';
import { t, applySetting, I18N_STORAGE_KEY, getLang } from 'features_i18n';
import type { LangSetting } from 'features_i18n';

class LangOption {
  code: LangSetting = 'system';
  label: string = '';

  constructor(code: LangSetting, label: string) {
    this.code = code;
    this.label = label;
  }
}

@Entry
@Component
struct LanguagePage {
  @StorageLink('themeMode') @Watch('onThemeModeChange') themeMode: ThemeMode = 'light';
  @State private langAtBuild: string = getLang();
  @State theme: Theme = buildTheme('light');
  // 沉浸式避让区高度（vp，services/systemBar publishAvoidArea 下发）
  @StorageProp('statusBarHeightVp') statusBarHeightVp: number = 0;
  @StorageProp('navBarHeightVp') navBarHeightVp: number = 0;
  @State selectedLang: string = 'system';

  private options: LangOption[] = [
    new LangOption('system', '跟随系统'),
    new LangOption('zh-CN', '简体中文'),
    new LangOption('en', 'English'),
  ];

  aboutToAppear(): void {
    this.theme = buildTheme(this.themeMode);
    this.loadCurrent();
  }

  onThemeModeChange(): void {
    this.theme = buildTheme(this.themeMode);
  }

  async handleSelect(code: LangSetting) {
    this.selectedLang = code;
    await kvStore.set(I18N_STORAGE_KEY, code);
    applySetting(code);
    // 本页处于可见态，立即切换 if 分支重建；其余页面由各自的 onPageShow 在回显时重建
    this.langAtBuild = getLang();
  }

  async loadCurrent() {
    const saved = await kvStore.get(I18N_STORAGE_KEY);
    this.selectedLang = saved ?? 'system';
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

        Text(t('settings.language'))
          .fontSize(18)
          .fontWeight(FontWeight.Medium)
          .fontColor(this.theme.colors.text)
          .layoutWeight(1)
          .textAlign(TextAlign.Center)

        Row().width(40).height(40)
      }
      .width('100%')
      .padding({ left: 20, right: 20, top: 16, bottom: 15 })

      // Language list
      Column() {
        ForEach(this.options, (option: LangOption): void => {
          Row() {
            Text(option.label)
              .fontSize(16)
              .fontColor(this.theme.colors.text)
              .layoutWeight(1)

            if (this.selectedLang === option.code) {
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
          .onClick(() => this.handleSelect(option.code))
        }, (option: LangOption): string => option.code)
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
