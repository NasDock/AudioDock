import { buildTheme, CommonNavBar, CommonButton, EmptyView, SkeletonBlock } from 'features_ui';
import type { ThemeMode } from 'features_ui';
import { t, getLang } from 'features_i18n';
import { collectionApi } from 'features_network';
import type { CollectionDetailResp, CollectionAlbumItem } from 'features_network';
import { likesHistory, EventPayloadId } from '../services/LikesHistoryService';
import { miniPlayerHasContent } from '../components/MiniPlayer';

/** NavDestination 详情页 param：ArkTS 严格模式不允许内联对象字面量，必须显式类/接口 */
interface DetailNavParam {
  id: string;
}

@Component
export struct CollectionDetailContent {
  // 路由栈与 id 由 RootShellPage 通过 navDestination builder 注入
  // 注意：属性名不能用 'id'（ArkUI CustomComponent 保留），统一用 'entityId'
  pathStack: NavPathStack = new NavPathStack();
  entityId: string = '';
  // 车机模式详情页跳转回调：非空时优先走右栏局部渲染，不进入全局路由
  carNavCallback?: (name: string, id: string) => void;
  // 车机模式返回回调：非空时返回按钮回退到右栏 tab 列表，不弹全局路由栈
  carBackCallback?: () => void;
  @State data: CollectionDetailResp | null = null;
  @State loading: boolean = true;
  @State error: string = '';
  @State liked: boolean = false;
  @StorageLink('themeMode') @Watch('onThemeModeChange') themeMode: ThemeMode = 'light';
  // 车机模式下 GlobalBottomBar 已在 RootShellPage 隐藏，本页也走全屏 NavDestination，
  // 不需要给 GlobalBottomBar/MiniPlayer 预留底部空间（修复底部多 56 空白）。
  @StorageLink('carModeEnabled') carModeEnabled: boolean = false;
  @State private langAtBuild: string = getLang();
  private theme = buildTheme('light');
  private unsub: () => void = () => {};

  onThemeModeChange(): void {
    this.theme = buildTheme(this.themeMode);
  }

  aboutToAppear(): void {
    this.theme = buildTheme(this.themeMode);
    this.load();
    this.unsub = likesHistory.on('albumLike', (e) => {
      const ev = e as EventPayloadId;
      if (ev.id === this.entityId) this.liked = ev.liked;
    });
    likesHistory.isAlbumLiked(this.entityId).then((v) => this.liked = v).catch(() => undefined);
  }

  aboutToDisappear(): void {
    this.unsub();
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
    if (this.langAtBuild === 'zh-CN') {
      this.LocalizedContent()
    } else {
      this.LocalizedContent()
    }
  }

  @Builder
  LocalizedContent() {
    Column() {
      CommonNavBar({ title: this.data?.name ?? '', theme: this.theme,
        onBack: () => {
          if (this.carBackCallback) {
            this.carBackCallback();
          } else {
            this.pathStack.pop();
          }
        } });
      if (this.loading) {
        Column({ space: 12 }) {
          SkeletonBlock({ blockHeight: 160, theme: this.theme });
          SkeletonBlock({ blockWidth: '60%', blockHeight: 20, theme: this.theme });
        }.padding(16).layoutWeight(1);
      } else if (this.error || !this.data) {
        EmptyView({ message: this.error || t('detail.retry_failed'), theme: this.theme })
          .layoutWeight(1);
      } else {
        this.content();
      }
      // GlobalBottomBar 已由 RootShellPage 在 Navigation 容器外统一挂载，跨页面常驻。
      // 这里不再手动挂载，避免每次进详情页重建一份。
    }.width('100%').height('100%').backgroundColor(this.theme.colors.background)
  }

  @Builder content() {
    Column({ space: 12 }) {
      Text(this.data!.name).fontSize(22).fontWeight(FontWeight.Bold);
      CommonButton({
        label: this.liked ? t('detail.unlike') : t('detail.like'),
        theme: this.theme, variant: this.liked ? 'secondary' : 'primary',
        onButtonClick: () => {
          if (this.liked) likesHistory.unlikeAlbum(this.entityId);
          else likesHistory.likeAlbum(this.entityId);
        },
      });
      List() {
        ForEach(this.data!.items ?? [], (it: CollectionAlbumItem) => {
          ListItem() {
            Row() {
              Text(it.album?.name ?? '').layoutWeight(1).fontSize(15);
            }.padding(12);
          }
          .onClick(() => {
            if (it.album) {
              if (this.carModeEnabled && this.carNavCallback) {
                this.carNavCallback('AlbumDetail', it.album.id);
              } else {
                const param: DetailNavParam = { id: it.album.id };
                this.pathStack.pushPath({ name: 'AlbumDetail', param: param });
              }
            }
          });
        }, (it: CollectionAlbumItem) => it.id);
      }
      .layoutWeight(1)
      // 避让悬浮的 GlobalBottomBar（Tab 栏 56 + MiniPlayer 60，MiniPlayer 空队列不占高度）
      .padding({ bottom: this.carModeEnabled ? 0 : (miniPlayerHasContent() ? 116 : 56) });
    }.padding(16).layoutWeight(1);
  }

  private async load(): Promise<void> {
    this.loading = true; this.error = '';
    try {
      this.data = await collectionApi.getById(this.entityId);
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
    } finally {
      this.loading = false;
    }
  }
}