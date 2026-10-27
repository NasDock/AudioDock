import router from '@ohos.router';
import { kvStore } from 'features_storage';
import { Logger } from 'audiodock_common';
import { buildTheme } from 'features_ui';
import type { Theme, ThemeMode } from 'features_ui';
import { t, getLang } from 'features_i18n';

/**
 * 桌面歌词样式设置页（独立页面而非模态框——SettingsPage 已有 bindSheet +
 * bindContentCover 两个模态，每组件只能绑一个 bindSheet，新增模态会冲突）。
 *
 * 样式四项全部 @StorageLink 双向绑定 AppStorage：改动立即被同进程的
 * DesktopLyricFloatPage 订阅刷新；落盘走 kvStore（EntryAbility 启动时恢复）。
 */
@Entry
@Component
struct DesktopLyricStylePage {
  @StorageLink('themeMode') @Watch('onThemeModeChange') themeMode: ThemeMode = 'light';
  @State private langAtBuild: string = getLang();
  @State theme: Theme = buildTheme('light');
  // 沉浸式避让区高度（vp，services/systemBar publishAvoidArea 下发）
  @StorageProp('statusBarHeightVp') statusBarHeightVp: number = 0;
  @StorageProp('navBarHeightVp') navBarHeightVp: number = 0;

  @StorageLink('desktopLyricsFontSize') fontSize: number = 18;
  @StorageLink('desktopLyricsTextColor') textColor: string = '#FFFFFF';
  @StorageLink('desktopLyricsStrokeColor') strokeColor: string = '#000000';
  @StorageLink('desktopLyricsStrokeWidth') strokeWidth: number = 2;

  private textColors: string[] = [
    '#FFFFFF', '#FFD700', '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#F38181', '#AA96DA',
  ];
  private strokeColors: string[] = [
    '#000000', '#FFFFFF', '#333333', '#8B0000', '#1E3A5F', '#4A148C',
  ];

  aboutToAppear(): void {
    this.theme = buildTheme(this.themeMode);
  }

  onThemeModeChange(): void {
    this.theme = buildTheme(this.themeMode);
  }

  onPageShow(): void {
    const cur = getLang();
    if (cur !== this.langAtBuild) this.langAtBuild = cur;
  }

  private persist(key: string, value: string): void {
    kvStore.set(key, value).catch((e: Error): void => {
      Logger.w('DesktopLyricStylePage', `persist ${key} failed: ${String(e)}`);
    });
  }

  build() {
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

        Text(t('settings.desktopLyricsStyle'))
          .fontSize(18)
          .fontWeight(FontWeight.Medium)
          .fontColor(this.theme.colors.text)
          .layoutWeight(1)
          .textAlign(TextAlign.Center)

        Row().width(40).height(40)
      }
      .width('100%')
      .padding({ left: 20, right: 20, top: 16, bottom: 15 })

      Scroll() {
        Column() {
          // 样式预览
          Row() {
            Text(t('settings.desktopLyricsPreview'))
              .fontSize(this.fontSize)
              .fontColor(this.textColor)
              .fontWeight(FontWeight.Medium)
              .maxLines(1)
              .textOverflow({ overflow: TextOverflow.Ellipsis })
              .textAlign(TextAlign.Center)
              .textShadow([
                { radius: 0, type: ShadowType.COLOR, color: this.strokeColor, offsetX: this.strokeWidth, offsetY: 0 },
                { radius: 0, type: ShadowType.COLOR, color: this.strokeColor, offsetX: -this.strokeWidth, offsetY: 0 },
                { radius: 0, type: ShadowType.COLOR, color: this.strokeColor, offsetX: 0, offsetY: this.strokeWidth },
                { radius: 0, type: ShadowType.COLOR, color: this.strokeColor, offsetX: 0, offsetY: -this.strokeWidth },
              ])
          }
          .width('100%')
          .justifyContent(FlexAlign.Center)
          .padding({ top: 24, bottom: 24 })
          .borderRadius(16)
          .backgroundColor('rgba(150,150,150,0.12)')
          .margin({ bottom: 20 })

          // 字号
          Row() {
            Text(t('settings.desktopLyricsFontSize'))
              .fontSize(17)
              .fontWeight(FontWeight.Medium)
              .fontColor(this.theme.colors.text)
              .layoutWeight(1)
            Text(`${Math.round(this.fontSize)}`)
              .fontSize(15)
              .fontColor(this.theme.colors.primary)
          }
          .width('100%')
          .margin({ bottom: 8 })

          Slider({
            value: this.fontSize,
            min: 12,
            max: 36,
            step: 1,
            style: SliderStyle.OutSet,
          })
            .blockColor(this.theme.colors.primary)
            .trackColor(this.theme.colors.border)
            .selectedColor(this.theme.colors.primary)
            .onChange((value: number, mode: SliderChangeMode): void => {
              this.fontSize = Math.round(value);
              if (mode === SliderChangeMode.End || mode === SliderChangeMode.Click) {
                this.persist('desktopLyricsFontSize', String(this.fontSize));
              }
            })
            .margin({ bottom: 20 })

          // 文字颜色
          Text(t('settings.desktopLyricsTextColor'))
            .fontSize(17)
            .fontWeight(FontWeight.Medium)
            .fontColor(this.theme.colors.text)
            .margin({ bottom: 12 })

          Flex({ wrap: FlexWrap.Wrap }) {
            ForEach(this.textColors, (c: string): void => {
              Column()
                .width(32)
                .height(32)
                .borderRadius(16)
                .backgroundColor(c)
                .borderWidth(this.textColor === c ? 3 : 1)
                .borderColor(this.textColor === c ? this.theme.colors.primary : this.theme.colors.border)
                .margin({ right: 12, bottom: 12 })
                .onClick((): void => {
                  this.textColor = c;
                  this.persist('desktopLyricsTextColor', c);
                })
            }, (c: string): string => c)
          }
          .margin({ bottom: 8 })

          // 描边颜色
          Text(t('settings.desktopLyricsStrokeColor'))
            .fontSize(17)
            .fontWeight(FontWeight.Medium)
            .fontColor(this.theme.colors.text)
            .margin({ bottom: 12 })

          Flex({ wrap: FlexWrap.Wrap }) {
            ForEach(this.strokeColors, (c: string): void => {
              Column()
                .width(32)
                .height(32)
                .borderRadius(16)
                .backgroundColor(c)
                .borderWidth(this.strokeColor === c ? 3 : 1)
                .borderColor(this.strokeColor === c ? this.theme.colors.primary : this.theme.colors.border)
                .margin({ right: 12, bottom: 12 })
                .onClick((): void => {
                  this.strokeColor = c;
                  this.persist('desktopLyricsStrokeColor', c);
                })
            }, (c: string): string => c)
          }
          .margin({ bottom: 8 })

          // 描边宽度
          Row() {
            Text(t('settings.desktopLyricsStrokeWidth'))
              .fontSize(17)
              .fontWeight(FontWeight.Medium)
              .fontColor(this.theme.colors.text)
              .layoutWeight(1)
            Text(this.strokeWidth.toFixed(1))
              .fontSize(15)
              .fontColor(this.theme.colors.primary)
          }
          .width('100%')
          .margin({ bottom: 8 })

          Slider({
            value: this.strokeWidth,
            min: 0,
            max: 8,
            step: 0.5,
            style: SliderStyle.OutSet,
          })
            .blockColor(this.theme.colors.primary)
            .trackColor(this.theme.colors.border)
            .selectedColor(this.theme.colors.primary)
            .onChange((value: number, mode: SliderChangeMode): void => {
              this.strokeWidth = value;
              if (mode === SliderChangeMode.End || mode === SliderChangeMode.Click) {
                this.persist('desktopLyricsStrokeWidth', String(this.strokeWidth));
              }
            })
        }
        .width('100%')
        .alignItems(HorizontalAlign.Start)
        .padding({ left: 20, right: 20 })
      }
      .layoutWeight(1)
    }
    .width('100%')
    .height('100%')
    .backgroundColor(this.theme.colors.background)
  }
}
