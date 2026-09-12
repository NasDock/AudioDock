import router from '@ohos.router';
import { buildTheme } from 'features_ui';
import type { Theme, ThemeMode } from 'features_ui';
import { kvStore } from 'features_storage';
import { plusApi } from 'features_network';
import type { VipCurrentLowestPriceData } from 'features_network';
import { GlobalBottomBar } from '../components/GlobalBottomBar';
import { PromotionDialog } from '../components/PromotionDialog';
import { MainPageContent } from './MainPage';
import { ArtistDetailContent } from './ArtistDetailPage';
import { AlbumDetailContent } from './AlbumDetailPage';
import { PlaylistDetailContent } from './PlaylistDetailPage';
import { CollectionDetailContent } from './CollectionDetailPage';
import { SearchContent } from './SearchPage';

/** 独立 Page 跳 NavDestination 内页面的桥接标志位（PlayerPage 内跳 ArtistDetail / AlbumDetail 时使用） */
interface PendingNavDest {
  name: string;
  id: string;
}

const PENDING_NAV_DEST_KEY = 'pendingNavDest';

/** kvStore key：用户主动忽略的活动 ID（同一活动不再弹窗） */
const IGNORED_PROMOTION_KEY = 'ignored_promotion_activity_id';

/** NavDestination 详情页 param：ArkTS 严格模式不允许内联对象字面量，必须显式类/接口。 */
interface DetailNavParam {
  id: string;
}

/**
 * 应用唯一根页面（@Entry）。
 * 把所有需要展示 GlobalBottomBar 的页面装进 Navigation 容器，
 * GlobalBottomBar 与 Navigation 平级渲染，跨 NavDestination 切换保持常驻。
 *
 * 对齐 mobile 的 _layout.tsx:
 *   <Stack>...</Stack>
 *   {showBottomBar && <GlobalBottomBar />}
 *
 * 当前壳内注册的 NavDestination:
 *   - MainTabs        主页（3 个 Tab 内容，监听 mainTabIndex 切换）
 *   - ArtistDetail    艺术家详情
 *   - AlbumDetail     专辑详情
 *   - PlaylistDetail  播放列表详情
 *   - CollectionDetail 合集详情
 *   - Search          搜索页
 *
 * 独立 @Entry 页面（PlayerPage / MVDetailPage / SettingsPage 等）仍走 router.pushUrl，
 * 不进入 NavDestination，避免改动 PlayerPage 的全屏交互。
 * PlayerPage 跳 ArtistDetail / AlbumDetail 时通过 pendingNavDest + router.back() 桥接到本页，
 * 由本页 onPageShow 读取并 pushPath 触发实际跳转。
 */
@Entry
@Component
struct RootShellPage {
  pathStack: NavPathStack = new NavPathStack();
  @StorageLink('themeMode') @Watch('onThemeModeChange') themeMode: ThemeMode = 'light';
  // 全局底部栏的显隐开关（NavDestination 子页用 hideBottomBar=false 显式请求显示；保留为后续扩展点）
  @StorageLink('hideBottomBar') hideBottomBar: boolean = false;
  // 车机模式开启时整个 RootShellPage 的 GlobalBottomBar 必须隐藏——
  // MainPageContent 的车机布局自己接管底部 tab 栏（嵌在 carContentPanel 里），
  // GlobalBottomBar 再渲染会把 tab 横跨整屏底部，挤占播放器面板内容区。
  @StorageLink('carModeEnabled') carModeEnabled: boolean = false;
  @State theme: Theme = buildTheme('light');
  @State promotion: VipCurrentLowestPriceData | null = null;
  @State showPromotion: boolean = false;

  onThemeModeChange(): void {
    this.theme = buildTheme(this.themeMode);
  }

  aboutToAppear(): void {
    this.theme = buildTheme(this.themeMode);
    // 首次进入压入主页 destination（路径栈为空时）
    if (this.pathStack.size() === 0) {
      this.pathStack.pushPath({ name: 'MainTabs' });
    }
    // 延迟检测优惠活动（等页面渲染完成后触发，仅一次）
    setTimeout(() => {
      this.checkPromotion();
    }, 2000);
  }

  /** 启动时检测优惠活动：有活动且未被忽略则弹窗 */
  private async checkPromotion(): Promise<void> {
    try {
      const pricing = await plusApi.getVipCurrentLowestPrice();
      // 无活动（activityId 为 null）→ 不弹
      if (!pricing?.activityId) return;

      // 已被用户忽略 → 不弹
      const ignored = await kvStore.get(IGNORED_PROMOTION_KEY);
      if (pricing.activityId === ignored) return;

      this.promotion = pricing;
      this.showPromotion = true;
    } catch (e) {
      // 接口异常静默失败，不弹窗
    }
  }

  /** 忽略当前活动（勾选「忽略此活动」后关闭时调用，写入 kvStore） */
  private ignorePromotion(): void {
    if (this.promotion?.activityId) {
      kvStore.set(IGNORED_PROMOTION_KEY, this.promotion.activityId).catch(() => {});
    }
    this.showPromotion = false;
    this.promotion = null;
  }

  /** 关闭弹窗（「下次再说」，不忽略，下次启动仍会再询问） */
  private dismissPromotion(): void {
    this.showPromotion = false;
    this.promotion = null;
  }

  /** 「去查看」→ 跳会员权益页 */
  private goToMemberBenefits(): void {
    router.pushUrl({ url: 'pages/MemberBenefitsPage' }).catch(() => {});
  }

  /** 从 PlayerPage 等独立 Page 返回时，检查是否有待跳转的 NavDestination */
  onPageShow(): void {
    const pending = AppStorage.get<PendingNavDest | null>(PENDING_NAV_DEST_KEY);
    if (pending && pending.name.length > 0 && pending.id.length > 0) {
      const param: DetailNavParam = { id: pending.id };
      this.pathStack.pushPath({ name: pending.name, param: param });
      AppStorage.setOrCreate<PendingNavDest | null>(PENDING_NAV_DEST_KEY, null);
    }
  }

  @Builder
  DestinationBuilder(name: string, param: Object) {
    // Navigation 的 navDestination 映射要求每个分支必须以 NavDestination 容器包裹，
    // 否则子页面无法挂载渲染 → 只剩平级的 GlobalBottomBar，内容区白屏。
    // @Builder 内不允许 const 局部变量声明（Only UI component syntax），
    // 所以参数表达式直接作为组件参数值传进去。
    if (name === 'MainTabs') {
      NavDestination() {
        MainPageContent({ pathStack: this.pathStack })
      }
      .hideTitleBar(true)
      .width('100%')
      .height('100%')
      .backgroundColor(this.theme.colors.background)
      .expandSafeArea([SafeAreaType.SYSTEM], [SafeAreaEdge.TOP, SafeAreaEdge.BOTTOM])
    } else if (name === 'ArtistDetail') {
      NavDestination() {
        ArtistDetailContent({
          pathStack: this.pathStack,
          entityId: ((param as DetailNavParam).id ?? ''),
        })
      }
      .hideTitleBar(true)
      .width('100%')
      .height('100%')
      .backgroundColor(this.theme.colors.background)
      .expandSafeArea([SafeAreaType.SYSTEM], [SafeAreaEdge.TOP, SafeAreaEdge.BOTTOM])
    } else if (name === 'AlbumDetail') {
      NavDestination() {
        AlbumDetailContent({
          pathStack: this.pathStack,
          entityId: ((param as DetailNavParam).id ?? ''),
        })
      }
      .hideTitleBar(true)
      .width('100%')
      .height('100%')
      .backgroundColor(this.theme.colors.background)
      .expandSafeArea([SafeAreaType.SYSTEM], [SafeAreaEdge.TOP, SafeAreaEdge.BOTTOM])
    } else if (name === 'PlaylistDetail') {
      NavDestination() {
        PlaylistDetailContent({
          pathStack: this.pathStack,
          entityId: ((param as DetailNavParam).id ?? ''),
        })
      }
      .hideTitleBar(true)
      .width('100%')
      .height('100%')
      .backgroundColor(this.theme.colors.background)
      .expandSafeArea([SafeAreaType.SYSTEM], [SafeAreaEdge.TOP, SafeAreaEdge.BOTTOM])
    } else if (name === 'CollectionDetail') {
      NavDestination() {
        CollectionDetailContent({
          pathStack: this.pathStack,
          entityId: ((param as DetailNavParam).id ?? ''),
        })
      }
      .hideTitleBar(true)
      .width('100%')
      .height('100%')
      .backgroundColor(this.theme.colors.background)
      .expandSafeArea([SafeAreaType.SYSTEM], [SafeAreaEdge.TOP, SafeAreaEdge.BOTTOM])
    } else if (name === 'Search') {
      NavDestination() {
        SearchContent({ pathStack: this.pathStack })
      }
      .hideTitleBar(true)
      .width('100%')
      .height('100%')
      .backgroundColor(this.theme.colors.background)
      .expandSafeArea([SafeAreaType.SYSTEM], [SafeAreaEdge.TOP, SafeAreaEdge.BOTTOM])
    }
  }

  /** 弹窗展示期间拦截返回键：用户必须通过按钮做出明确选择 */
  onBackPress(): boolean {
    return this.showPromotion;
  }

  build() {
    Stack({ alignContent: Alignment.Bottom }) {
      Navigation(this.pathStack) {
        // 占位：首次压栈在 aboutToAppear 完成
        Column().width('100%').height('100%')
      }
      .width('100%').height('100%')
      .navDestination(this.DestinationBuilder)
      .hideNavBar(true)
      .backgroundColor(this.theme.colors.background)
      // Navigation 背景延伸到状态栏与导航栏区域。NavDestination 默认 extendSafeArea
      // 但背景透明，会盖住下层根 Stack 的黑背景、透出窗口白底，形成状态栏下方白色条带。
      // 让 Navigation 自身黑背景延伸，填充 NavDestination 透明层下方。
      .expandSafeArea([SafeAreaType.SYSTEM], [SafeAreaEdge.TOP, SafeAreaEdge.BOTTOM])

      if (!this.hideBottomBar && !this.carModeEnabled) {
        GlobalBottomBar({ pathStack: this.pathStack })
      }

      // 全局优惠活动弹窗（照抄 Index.ets 的 Stack 遮罩模式）
      if (this.showPromotion) {
        Column() {
          PromotionDialog({
            theme: this.theme,
            promotion: this.promotion,
            onClose: (): void => this.dismissPromotion(),
            onIgnore: (): void => this.ignorePromotion(),
            onGoView: (): void => this.goToMemberBenefits(),
          })
        }
        .width('100%')
        .height('100%')
        .padding({ left: 32, right: 32 })
        .backgroundColor('rgba(0,0,0,0.5)')
        .justifyContent(FlexAlign.Center)
        .alignItems(HorizontalAlign.Center)
        .onClick(() => {
          // 拦截点击穿透：用户必须通过按钮做出明确选择
        })
      }
    }
    .width('100%').height('100%')
    .backgroundColor(this.theme.colors.background)
    // 根背景延伸到状态栏与底部小横条区域，让系统栏区域显示主题背景色（深色主题下变黑）。
    // 子组件仍在安全区内布局、自动避让，不受影响。对齐 mobile 的 edgeToEdgeEnabled。
    .expandSafeArea([SafeAreaType.SYSTEM], [SafeAreaEdge.TOP, SafeAreaEdge.BOTTOM])
  }
}
