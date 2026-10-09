import router from '@ohos.router';
import { kvStore } from 'features_storage';
import { Logger } from 'audiodock_common';
import { buildTheme, CommonNavBar } from 'features_ui';
import type { Theme, ThemeMode } from 'features_ui';

// 与 mobile modal.tsx 的 DEFAULT_SECTIONS 保持一致（id 用于持久化，title 仅展示）。
class SectionItem {
  id: string = '';
  title: string = '';

  constructor(id: string, title: string) {
    this.id = id;
    this.title = title;
  }
}

const DEFAULT_SECTIONS: SectionItem[] = [
  new SectionItem('history', '继续收听（有声书模式）'),
  new SectionItem('artists', '艺术家'),
  new SectionItem('recent', '最近上新'),
  new SectionItem('recommended', '为你推荐'),
  new SectionItem('tracks', '上新单曲（音乐模式）'),
];

@Entry
@Component
struct SectionOrderPage {
  @State items: SectionItem[] = [];
  @StorageLink('themeMode') @Watch('onThemeModeChange') themeMode: ThemeMode = 'light';
  @State theme: Theme = buildTheme('light');
  // 沉浸式避让区高度（vp，services/systemBar publishAvoidArea 下发）
  @StorageProp('statusBarHeightVp') statusBarHeightVp: number = 0;
  @StorageProp('navBarHeightVp') navBarHeightVp: number = 0;

  aboutToAppear(): void {
    this.theme = buildTheme(this.themeMode);
    this.loadOrder();
  }

  onThemeModeChange(): void {
    this.theme = buildTheme(this.themeMode);
  }

  private defaultItems(): SectionItem[] {
    const arr: SectionItem[] = [];
    for (const s of DEFAULT_SECTIONS) arr.push(new SectionItem(s.id, s.title));
    return arr;
  }

  async loadOrder(): Promise<void> {
    const items = this.defaultItems();
    try {
      const order = await kvStore.getJSON<string[]>('section_order');
      if (order) {
        items.sort((a: SectionItem, b: SectionItem): number => {
          const ia = order.indexOf(a.id);
          const ib = order.indexOf(b.id);
          if (ia === -1) return 1;
          if (ib === -1) return -1;
          return ia - ib;
        });
      }
    } catch (e) {
      Logger.w('SectionOrderPage', `load order failed: ${String(e)}`);
    }
    this.items = items;
  }

  moveUp(index: number): void {
    if (index <= 0) return;
    const next = this.items.slice();
    const tmp = next[index - 1];
    next[index - 1] = next[index];
    next[index] = tmp;
    this.items = next;
  }

  moveDown(index: number): void {
    if (index >= this.items.length - 1) return;
    const next = this.items.slice();
    const tmp = next[index + 1];
    next[index + 1] = next[index];
    next[index] = tmp;
    this.items = next;
  }

  async saveOrder(): Promise<void> {
    const ids: string[] = [];
    for (const it of this.items) ids.push(it.id);
    try {
      await kvStore.setJSON<string[]>('section_order', ids);
      // 通知首页按最新顺序重排（对齐 mobile useFocusEffect 回到页面重新排序）。
      AppStorage.setOrCreate('sectionOrderVersion', Date.now());
    } catch (e) {
      Logger.e('SectionOrderPage', `save order failed: ${String(e)}`);
    }
    router.back();
  }

  @Builder
  OrderRow(item: SectionItem, index: number) {
    Row() {
      Text(item.title)
        .fontSize(16).fontColor(this.theme.colors.text).layoutWeight(1)
        .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })

      Row({ space: 8 }) {
        Text('↑')
          .fontSize(20).textAlign(TextAlign.Center)
          .fontColor(index === 0 ? this.theme.colors.textSecondary : this.theme.colors.primary)
          .width(44).height(44)
          .opacity(index === 0 ? 0.4 : 1)
          .onClick((): void => this.moveUp(index))
        Text('↓')
          .fontSize(20).textAlign(TextAlign.Center)
          .fontColor(index === this.items.length - 1 ? this.theme.colors.textSecondary : this.theme.colors.primary)
          .width(44).height(44)
          .opacity(index === this.items.length - 1 ? 0.4 : 1)
          .onClick((): void => this.moveDown(index))
      }
    }
    .width('100%').height(64)
    .padding({ left: 20, right: 12 })
    .alignItems(VerticalAlign.Center)
    .border({ width: { bottom: 1 }, color: this.theme.colors.border })
  }

  build() {
    Column() {
      CommonNavBar({ title: '调整顺序', theme: this.theme, onBack: (): void => router.back() })

      Text('使用上移 / 下移调整版块顺序')
        .fontSize(14).fontColor(this.theme.colors.textSecondary)
        .width('100%').padding({ left: 20, right: 20, top: 16, bottom: 8 })

      Column() {
        ForEach(this.items, (item: SectionItem, index: number) => {
          this.OrderRow(item, index);
        }, (item: SectionItem, index: number) => `${index}-${item.id}`)
      }
      .width('100%')

      Button('保存设置')
        .width('100%').height(50)
        .backgroundColor(this.theme.colors.primary)
        .fontColor(this.theme.colors.onPrimary)
        .fontSize(16).fontWeight(FontWeight.Bold)
        .borderRadius(10)
        .margin({ left: 20, right: 20, top: 24, bottom: 24 })
        .onClick(() => this.saveOrder())
    }
    .width('100%').height('100%').backgroundColor(this.theme.colors.background)
    // 沉浸式避让：全屏布局下页面从物理 y=0 排版，根容器 padding 避开状态栏/小横条
    .padding({ top: this.statusBarHeightVp, bottom: this.navBarHeightVp })
  }
}
