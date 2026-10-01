import router from '@ohos.router';
import { buildTheme, type Theme, type ThemeMode } from 'features_ui';
import { t, getLang } from 'features_i18n';
import { SOURCEMAP, SOURCETIPSMAP } from '../utils/networkUtils';

/**
 * 数据源选择页，1:1 对齐 mobile 的 LoginSelectionScreen（app/login.tsx）：
 * 顶部居中 App Logo + 标题 + 副标题；下方按 SOURCEMAP 顺序列出各数据源卡片
 * （图标 + 名称 + 描述 + 右侧箭头），点按携带 sourceType 进入登录页。
 */
@Entry
@Component
struct SourceSelectPage {
  @StorageLink('themeMode') @Watch('onThemeModeChange') themeMode: ThemeMode = 'light';
  @State private langAtBuild: string = getLang();
  @State theme: Theme = buildTheme('light');
  // 沉浸式避让区高度（vp，services/systemBar publishAvoidArea 下发）
  @StorageProp('statusBarHeightVp') statusBarHeightVp: number = 0;
  @StorageProp('navBarHeightVp') navBarHeightVp: number = 0;

  aboutToAppear(): void {
    this.theme = buildTheme(this.themeMode);
  }

  onThemeModeChange(): void {
    this.theme = buildTheme(this.themeMode);
  }

  private logoResource(key: string): Resource {
    if (key === 'Subsonic') {
      return $r('app.media.subsonic');
    }
    if (key === 'Emby') {
      return $r('app.media.emby');
    }
    return $r('app.media.logo');
  }

  private handleSelect(key: string): void {
    router.pushUrl({ url: 'pages/LoginPage', params: { sourceType: key } });
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
      Scroll() {
        Column() {
          // 顶部：居中 Logo + 标题 + 副标题
          Column() {
            Image($r('app.media.logo'))
              .width(100)
              .height(100)
              .borderRadius(16)
              .margin({ bottom: 20 })
            Text(t('loginSelect.title'))
              .fontSize(18)
              .fontWeight(FontWeight.Bold)
              .fontColor(this.theme.colors.text)
              .margin({ bottom: 10 })
            Text(t('loginSelect.subtitle'))
              .fontSize(12)
              .fontColor(this.theme.colors.textSecondary)
              .textAlign(TextAlign.Center)
          }
          .width('100%')
          .alignItems(HorizontalAlign.Center)
          .margin({ top: 40, bottom: 40 })

          // 数据源卡片列表
          Column({ space: 15 }) {
            ForEach(Object.keys(SOURCEMAP), (key: string) => {
              Row() {
                Image(this.logoResource(key))
                  .width(50)
                  .height(50)
                  .margin({ right: 15 })
                Column() {
                  Text(key)
                    .fontSize(18)
                    .fontWeight(FontWeight.Bold)
                    .fontColor(this.theme.colors.text)
                    .margin({ bottom: 4 })
                  Text(SOURCETIPSMAP[key] ?? '')
                    .fontSize(12)
                    .fontColor(this.theme.colors.textSecondary)
                    .maxLines(2)
                    .textOverflow({ overflow: TextOverflow.Ellipsis })
                }
                .layoutWeight(1)
                .alignItems(HorizontalAlign.Start)
                Text('›')
                  .fontSize(28)
                  .fontColor(this.theme.colors.text)
                  .margin({ left: 10 })
              }
              .width('100%')
              .padding(20)
              .borderRadius(16)
              .borderWidth(1)
              .borderColor(this.theme.colors.border)
              .backgroundColor(this.theme.colors.surface)
              .onClick(() => this.handleSelect(key))
            }, (key: string) => key)
          }
          .width('100%')
        }
        .width('100%')
        .padding({ left: 20, right: 20, bottom: 40 })
        .constraintSize({ maxWidth: 600 })
      }
      .layoutWeight(1)
      .scrollBar(BarState.Off)
      .align(Alignment.Top)
    }
    .width('100%')
    .height('100%')
    .backgroundColor(this.theme.colors.background)
  }
}
