import { BreakpointSystem, BreakPointType } from '@ohos/common';
import { commonConstants } from '../constants/CommonConstants';

/**
 * SystemCapabilitiesIndex page tests whether the system has the capability of
 * SystemCapability.Location.Location.Core.
 */
@Entry
@Component
struct SystemCapabilitiesIndex {
  @StorageLink('mainBreakpoint') currentBreakpoint: string = commonConstants.breakpointsInitializeName;
  private readonly breakpointSystem: BreakpointSystem = new BreakpointSystem(commonConstants.breakpointSystemName);
  private locationCapability: boolean = false;

  aboutToAppear() {
    this.locationCapability = canIUse(commonConstants.locationCapability);
    this.breakpointSystem.register(this.getUIContext());
  }

  aboutToDisappear() {
    this.breakpointSystem.unregister();
  }

  build() {
    Column() {
      Row() {
        Stack() {
          SymbolGlyph($r('sys.symbol.chevron_left'))
            .fontSize($r('app.float.arrow_width'))
            .onClick(() => {
              this.getUIContext().getRouter().back();
            })
            .fontColor([$r('sys.color.titlebar_icon_color')])
        }
        .width($r('app.float.arrow_width'))
        .borderRadius($r('app.float.arrow_left_borderRadius'))
        .backgroundColor($r('sys.color.ohos_id_color_button_normal'))
      }
      .width(commonConstants.systemRowWidth)
      .height($r('app.float.arrow_item_height'))
      .position({ x: $r('app.float.system_capabilities_arrow_positionX') })

      Column() {
        Image(this.locationCapability ? $r('app.media.ic_location_yes') : $r('app.media.ic_location_no'))
          .width(new BreakPointType({
            sm: $r('app.float.system_capabilities_img_sm_width'),
            md: $r('app.float.system_capabilities_img_md_width'),
            lg: $r('app.float.system_capabilities_img_lg_width'),
            xl: $r('app.float.system_capabilities_img_xl_width')
          })
          .getValue(this.currentBreakpoint))
          .height(new BreakPointType({
            sm: $r('app.float.system_capabilities_img_sm_height'),
            md: $r('app.float.system_capabilities_img_md_height'),
            lg: $r('app.float.system_capabilities_img_lg_height'),
            xl: $r('app.float.system_capabilities_img_xl_height')
          })
          .getValue(this.currentBreakpoint))
          .margin({ bottom: $r('app.float.system_capabilities_margin_bottom') })
        Text(this.locationCapability ? $r('app.string.location_cap_valid') : $r('app.string.location_cap_invalid'))
          .fontSize($r('app.float.system_capabilities_text_font_size'))
          .fontWeight(commonConstants.textFontWeight)
          .fontColor(this.locationCapability ?
            $r('sys.color.ohos_id_color_text_tertiary') : $r('sys.color.ohos_id_color_text_secondary'))
          .margin({
            left: $r('app.float.system_capabilities_text_margin'),
            right: $r('app.float.system_capabilities_text_margin')
          })
      }
      .width(commonConstants.systemColumnWidth)
    }
    .backgroundColor($r('sys.color.ohos_id_color_sub_background'))
    .height(commonConstants.systemColumnHeight)
    .width(commonConstants.systemColumnWidth)
    .justifyContent(FlexAlign.Center)
  }
}