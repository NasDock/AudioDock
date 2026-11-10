import { bucketWidth, getImageUrl } from '../utils/image';
import { resolveFnosCover } from '../utils/fnosCover';
import { IS_INTERNAL_KEY } from '../utils/networkMode';
import { isFnosMediaUrl } from 'features_network';
import { buildTheme } from 'features_ui';
import type { Theme, ThemeMode } from 'features_ui';

@Component
export struct CoverImage {
  @Prop @Watch('onPathChange') path: string | null = null;
  /** 显示宽度（vp）。直接作为目标设备像素宽度参与档位量化，见 utils/image.ts */
  @Prop imgWidth: number = 60;
  @Prop imgHeight: number = 60;
  @Prop radius: number | string = 8;
  @Prop fallbackText: string = '?';
  @StorageLink('themeMode') @Watch('onThemeModeChange') themeMode: ThemeMode = 'light';
  // 内外网切换时 AppStorage 会更新，这里必须 @Watch 主动重算 URL：
  // currentUrl 是 @State，只在 aboutToAppear / onPathChange 里算，不会自动跟着变。
  @StorageLink(IS_INTERNAL_KEY) @Watch('onNetworkModeChange') isInternal: boolean = false;
  @State theme: Theme = buildTheme('light');
  @State failed: boolean = false;
  @State currentUrl: string = '';
  /** 正在解析的飞牛封面 key，用于丢弃过期的异步结果 */
  private pendingCoverKey: string = '';

  aboutToAppear() {
    this.theme = buildTheme(this.themeMode);
    this.currentUrl = this.buildUrl();
  }

  onThemeModeChange(): void {
    this.theme = buildTheme(this.themeMode);
  }

  // path 变化时刷新 URL 并清掉失败态（切歌换封面依赖这个）
  onPathChange() {
    this.currentUrl = this.buildUrl();
    this.failed = false;
  }

  // 切内外网后重算 URL（大图档位才会真的变化，缩略图档 URL 不变不会触发重建）
  onNetworkModeChange(): void {
    this.currentUrl = this.buildUrl();
    this.failed = false;
  }

  /** imgWidth 是 vp，按 2 倍估算目标设备像素宽度 */
  private buildUrl(): string {
    const url: string = getImageUrl(this.path, bucketWidth(this.imgWidth * 2));
    // 飞牛封面只认 Cookie/Authorization，Image 加不了请求头：
    // 先带鉴权下载落盘，再用本地 file:// 地址渲染（见 utils/fnosCover.ets）
    if (isFnosMediaUrl(url)) {
      this.loadFnosCover(url);
      return '';
    }
    return url;
  }

  private loadFnosCover(url: string): void {
    const key: string = url;
    this.pendingCoverKey = key;
    resolveFnosCover(url).then((local: string): void => {
      // 期间 path 又变了（快速滑动/切歌），丢弃这次结果
      if (this.pendingCoverKey !== key) return;
      this.currentUrl = local;
    }).catch((): void => {
      if (this.pendingCoverKey !== key) return;
      this.failed = true;
    });
  }

  @Builder
  Fallback() {
    Column() {
      Text((this.fallbackText || '?').substring(0, 1))
        .fontSize(20)
        .fontColor(this.theme.colors.textSecondary)
        .fontWeight(FontWeight.Bold)
    }
    .width(this.imgWidth)
    .height(this.imgHeight)
    .borderRadius(this.radius)
    .backgroundColor(this.theme.colors.surface)
    .justifyContent(FlexAlign.Center)
  }

  build() {
    if (this.failed || !this.currentUrl) {
      this.Fallback();
    } else {
      Stack({ alignContent: Alignment.Center }) {
        Image(this.currentUrl)
          .width(this.imgWidth)
          .height(this.imgHeight)
          .borderRadius(this.radius)
          .objectFit(ImageFit.Cover)
          .onError(() => {
            this.failed = true;
          })
        if (this.failed) {
          this.Fallback();
        }
      }
      .width(this.imgWidth)
      .height(this.imgHeight)
    }
  }
}
