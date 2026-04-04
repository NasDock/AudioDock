import { BreakpointSystem, BreakPointType } from '@ohos/common';
import { GridComponent } from '../view/GridComponent';
import { commonConstants } from '../constants/CommonConstants';
import { TabBarItem } from '../viewmodel/TabBarItem';
import TabsViewModel from '../viewmodel/TabsViewModel';

/**
 * ResponsiveLayout page is the entry of project responsiveLayout which combining tab components with grid components.
 */
@Builder
export function responsiveLayout() {
  Column() {
    TabIndex()
  }
}

@Component
export struct TabIndex {
  @State currentIndex: number = 0;
  @State tabs: TabBarItem[] = TabsViewModel.getTabData();
  @StorageLink('mainBreakpoint') currentBreakpoint: string = commonConstants.breakpointsInitializeName;
  private readonly breakpointSystem: BreakpointSystem = new BreakpointSystem(commonConstants.breakpointSystemName);

  @Builder tabBarBuilder(tabBar: TabBarItem) {
    Flex({
      direction: new BreakPointType({
        sm: FlexDirection.Column,
        md: FlexDirection.Row,
        lg: FlexDirection.Column,
        xl: FlexDirection.Column
      })
      .getValue(this.currentBreakpoint), justifyContent: FlexAlign.Center, alignItems: ItemAlign.Center
    }) {
      SymbolGlyph($r('sys.symbol.person_crop_circle_fill_1'))
        .fontColor(this.currentIndex === tabBar.id ?
          [$r('sys.color.ohos_id_color_text_primary_activated')] : [$r('sys.color.ohos_id_color_text_secondary')])
        .fontSize($r('app.float.tab_img_width'))
      Text(tabBar.name)
        .fontSize($r('app.float.tab_text_font_size'))
        .fontColor(this.currentIndex === tabBar.id ?
          $r('sys.color.ohos_id_color_text_primary_activated') : $r('sys.color.ohos_id_color_text_secondary'))
        .margin(new BreakPointType<Padding>({
          sm: { top: $r('app.float.tab_text_sm_top'), left: $r('app.float.tab_text_sm_left') },
          md: { top: $r('app.float.tab_text_md_top'), left: $r('app.float.tab_text_md_left') },
          lg: { top: $r('app.float.tab_text_lg_top'), left: $r('app.float.tab_text_lg_left') },
          xl: { top: $r('app.float.tab_text_xl_top'), left: $r('app.float.tab_text_xl_left') }
        })
        .getValue(this.currentBreakpoint))
    }
    .width(commonConstants.flexTabBarWidth)
    .height(commonConstants.flexTabBarHeight)
  }

  aboutToAppear() {
    this.breakpointSystem.register(this.getUIContext());
  }

  aboutToDisappear() {
    this.breakpointSystem.unregister();
  }

  build() {
    Column() {
      Tabs({
        barPosition: new BreakPointType({
          sm: BarPosition.End,
          md: BarPosition.End,
          lg: BarPosition.Start,
          xl: BarPosition.Start
        })
        .getValue(this.currentBreakpoint)
      }) {
        ForEach(this.tabs, (item: TabBarItem) => {
          TabContent() {
            GridComponent()
          }
          .tabBar(this.tabBarBuilder(item))
          .width(commonConstants.tabContentWidth)
          .height(commonConstants.tabContentHeight)
        }, (item: TabBarItem) => item.id.toString())
      }
      .vertical(new BreakPointType({
        sm: commonConstants.tabSmVertical,
        md: commonConstants.tabMdVertical,
        lg: commonConstants.tabLgVertical,
        xl: commonConstants.tabXlVertical
      })
      .getValue(this.currentBreakpoint))
      .barWidth(new BreakPointType({
        sm: commonConstants.tabSmBarWidth,
        md: commonConstants.tabMdBarWidth,
        lg: commonConstants.tabLgBarWidth,
        xl: commonConstants.tabXlBarWidth
      })
      .getValue(this.currentBreakpoint))
      .barHeight(new BreakPointType({
        sm: commonConstants.tabSmBarHeight,
        md: commonConstants.tabMdBarHeight,
        lg: commonConstants.tabLgBarHeight,
        xl: commonConstants.tabXlBarHeight
      })
      .getValue(this.currentBreakpoint))
      .onAnimationStart((index: number, targetIndex: number) => {
        this.currentIndex = targetIndex;
      })
    }
    .backgroundColor($r('sys.color.ohos_id_color_sub_background'))
  }
}