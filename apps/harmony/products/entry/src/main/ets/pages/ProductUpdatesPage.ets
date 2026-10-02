import router from '@ohos.router';
import { buildTheme } from 'features_ui';
import type { Theme, ThemeMode } from 'features_ui';
import { t, getLang } from 'features_i18n';
import { listRecentReleases } from '../services/updateService';
import type { UpdateInfo } from '../services/updateService';
import { Logger } from 'audiodock_common';

@Entry
@Component
struct ProductUpdatesPage {
  @StorageLink('themeMode') @Watch('onThemeModeChange') themeMode: ThemeMode = 'light';
  @State private langAtBuild: string = getLang();
  @State theme: Theme = buildTheme('light');
  // 沉浸式避让区高度（vp，services/systemBar publishAvoidArea 下发）
  @StorageProp('statusBarHeightVp') statusBarHeightVp: number = 0;
  @StorageProp('navBarHeightVp') navBarHeightVp: number = 0;
  @State releases: UpdateInfo[] = [];
  @State loading: boolean = true;
  @State error: string = '';

  aboutToAppear(): void {
    this.theme = buildTheme(this.themeMode);
    this.loadReleases();
  }

  onThemeModeChange(): void {
    this.theme = buildTheme(this.themeMode);
  }

  async loadReleases(): Promise<void> {
    this.loading = true;
    this.error = '';
    try {
      // 拉最近 20 个 release（对齐 mobile product-updates.tsx fetchReleases 的 GitHub API）
      const list = await listRecentReleases(20);
      this.releases = list;
      if (list.length === 0) {
        this.error = t('productUpdatesNoUpdates');
      }
    } catch (e) {
      Logger.w('ProductUpdatesPage', `loadReleases failed: ${String(e)}`);
      this.error = t('productUpdatesNoUpdates');
    } finally {
      this.loading = false;
    }
  }

  formatDate(iso: string): string {
    if (iso.length === 0) return '';
    // 简单取 YYYY-MM-DD（前 10 字符），避免引时区库
    return iso.slice(0, 10);
  }

  onPageShow(): void {
    // 语言可能在后台（语言页/系统设置）被修改：回显时若语言已变化，切换 if 分支重建整页。
    const cur = getLang();
    if (cur !== this.langAtBuild) this.langAtBuild = cur;
  }

  build() {
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

        Text(t('settings.productUpdates'))
          .fontSize(18)
          .fontWeight(FontWeight.Medium)
          .fontColor(this.theme.colors.text)
          .layoutWeight(1)
          .textAlign(TextAlign.Center)

        Row().width(40).height(40)
      }
      .width('100%')
      .padding({ left: 20, right: 20, top: 16, bottom: 15 })

      // 内容区
      if (this.loading) {
        Column() {
          LoadingProgress()
            .width(40).height(40)
            .color(this.theme.colors.primary)
        }
        .layoutWeight(1)
        .justifyContent(FlexAlign.Center)
        .width('100%')
      } else if (this.releases.length === 0) {
        Column() {
          Text(this.error.length > 0 ? this.error : t('productUpdates.noUpdates'))
            .fontSize(14)
            .fontColor(this.theme.colors.textSecondary)
            .textAlign(TextAlign.Center)
        }
        .layoutWeight(1)
        .justifyContent(FlexAlign.Center)
        .width('100%')
      } else {
        List({ space: 12 }) {
          ForEach(this.releases, (release: UpdateInfo): void => {
            ListItem() {
              Column({ space: 8 }) {
                Row() {
                  Text(release.version)
                    .fontSize(16)
                    .fontWeight(FontWeight.Bold)
                    .fontColor(this.theme.colors.text)
                    .layoutWeight(1)
                  Text(this.formatDate(release.publishedAt))
                    .fontSize(12)
                    .fontColor(this.theme.colors.textSecondary)
                }
                .width('100%')

                Text(release.body.length > 0 ? release.body : t('productUpdatesNoUpdates'))
                  .fontSize(13)
                  .fontColor(this.theme.colors.textSecondary)
                  .maxLines(8)
                  .textOverflow({ overflow: TextOverflow.Ellipsis })
              }
              .width('100%')
              .padding({ top: 14, bottom: 14, left: 16, right: 16 })
              .borderRadius(10)
              .backgroundColor(this.theme.colors.surface)
            }
          }, (release: UpdateInfo): string => release.version)
        }
        .layoutWeight(1)
        .width('100%')
        .padding({ left: 16, right: 16, top: 4, bottom: 16 })
        .scrollBar(BarState.Off)
      }
    }
    .width('100%')
    .height('100%')
    .backgroundColor(this.theme.colors.background)
  }
}