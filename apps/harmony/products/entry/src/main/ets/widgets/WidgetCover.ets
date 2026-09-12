import fs from '@ohos.file.fs';
import { Logger } from 'audiodock_common';
import { WidgetIcon } from './WidgetIcon';

/**
 * 卡片专用封面组件（卡片进程独立运行，不依赖 AppStorage/EntryAbility context）。
 *
 * 封面解析三级兜底（对齐官方卡片最佳实践「进程侧预取，卡片直读本地」）：
 * 1. data:base64 内联（WidgetBridge 预取封面后直接塞进 FormBindingData，
 *    无需网络/文件 IO，卡片渲染最稳定）
 * 2. file:// 本地缓存（同应用 filesDir，卡片进程同 UID 可读）
 * 3. 网络 URL 兜底（相对路径用模块级 baseURL 补全成绝对地址 ——
 *    卡片进程不 import features_network，避免拉起整张网络栈）
 *
 * 注意：图片加载失败时不抛错，保留占位 UI（卡片 UI 必须容错）。
 */

const TAG = 'WidgetCover';

export interface CoverSize {
  width: number;
  height: number;
  radius: number;
}

export class COVER_PRESETS {
  static readonly xlarge: CoverSize = { width: 198, height: 198, radius: 14 };
  static readonly large: CoverSize = { width: 96, height: 96, radius: 14 };
  static readonly medium: CoverSize = { width: 64, height: 64, radius: 12 };
  static readonly small: CoverSize = { width: 40, height: 40, radius: 8 };
}

/** 共享封面解析逻辑：WidgetCover / WidgetBackground / 列表卡片统一走这里。 */
export class WidgetCoverResolver {
  /** WidgetBridge.ensureCoverLocal 下载封面后写入（模块级，卡片进程内可见）。 */
  static baseUrl: string = '';

  /**
   * 把任意 cover 字段值解析成 Image 可用的 src。
   * data:/file:/http(s) 直通；相对路径 /covers/xxx 用 baseUrl 补全。
   * 解析不出来返回 ''（调用方渲染占位）。
   */
  static resolve(cover: string): string {
    if (cover === '') return '';
    if (cover.startsWith('data:')) return cover;
    if (cover.startsWith('file://')) {
      // 卡片进程对 file:// 的访问可能因沙箱时序失败，先校验存在性
      const path = cover.substring('file://'.length);
      try {
        if (fs.accessSync(path)) return cover;
      } catch (e) {
        Logger.w(TAG, `resolve file miss: ${path}`);
      }
      return '';
    }
    if (cover.startsWith('http://') || cover.startsWith('https://')) return cover;
    // 相对路径（/covers/xxx）：补全为绝对 URL
    if (WidgetCoverResolver.baseUrl !== '') {
      const base = WidgetCoverResolver.baseUrl.endsWith('/')
        ? WidgetCoverResolver.baseUrl.substring(0, WidgetCoverResolver.baseUrl.length - 1)
        : WidgetCoverResolver.baseUrl;
      return cover.startsWith('/') ? `${base}${cover}` : `${base}/${cover}`;
    }
    return '';
  }
}

@Component
export struct WidgetCover {
  @Prop cover: string = '';
  @Prop preset: 'xlarge' | 'large' | 'medium' | 'small' = 'medium';

  build() {
    Stack({ alignContent: Alignment.Center }) {
      // 占位底（白色 10% 透明）
      Rect()
        .width('100%')
        .height('100%')
        .fill('#1AFFFFFF')
        .radius(this.getSize().radius);

      // 封面图
      if (this.resolved() !== '') {
        Image(this.resolved())
          .width('100%')
          .height('100%')
          .objectFit(ImageFit.Cover)
          .borderRadius(this.getSize().radius);
      }

      // 占位音符（无封面时显示）
      if (this.resolved() === '') {
        WidgetIcon('music', this.getSize().width * 0.4, '#B3FFFFFF');
      }
    }
    .width(this.getSize().width)
    .height(this.getSize().height);
  }

  private resolved(): string {
    return WidgetCoverResolver.resolve(this.cover);
  }

  private getSize(): CoverSize {
    if (this.preset === 'xlarge') return COVER_PRESETS.xlarge;
    if (this.preset === 'large') return COVER_PRESETS.large;
    if (this.preset === 'small') return COVER_PRESETS.small;
    return COVER_PRESETS.medium;
  }
}
