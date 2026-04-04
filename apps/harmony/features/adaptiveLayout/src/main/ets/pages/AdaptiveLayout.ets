import { SliderComponent } from '../view/SliderComponent';
import { commonConstants } from '../constants/CommonConstants';

const CONTAINER_WIDTH = 55;

@Component
struct AdaptiveLayoutItem {
  @LocalStorageLink('containerWidth') containerWidth: number = CONTAINER_WIDTH;

  build() {
    Column() {
      Column() {
        Row() {
          Row()
            .width($r('app.float.flexible_left_item_width'))
            .height($r('app.float.flexible_left_item_height'))
            .backgroundColor($r('sys.color.ohos_id_color_component_normal'))
            .borderRadius($r('app.float.flexible_left_item_border_radius'))
          Blank()
          Row()
            .width($r('app.float.flexible_right_item_width'))
            .height($r('app.float.flexible_right_item_height'))
            .backgroundColor($r('sys.color.ohos_id_color_component_normal'))
            .borderRadius($r('app.float.flexible_right_item_border_radius'))
        }
        .height($r('app.float.flexible_item_height'))
        .borderRadius($r('app.float.flexible_item_border_radius'))
        .padding({
          left: $r('app.float.flexible_item_padding_left'),
          right: $r('app.float.flexible_item_padding_right')
        })
        .backgroundColor($r('sys.color.ohos_id_color_background'))
        .width('' + this.containerWidth + commonConstants.percentSign)
      }
      .width(commonConstants.columnWidth)
      .flexShrink(commonConstants.columnFlexShrink)
      .height(commonConstants.columnHeight)
      .justifyContent(FlexAlign.Center)

      Column() {
        SliderComponent()
      }
      .margin({ bottom: commonConstants.sliderMargin })
    }
    .height(commonConstants.height)
    .width(commonConstants.width)
  }
}

@Builder
export function adaptiveLayout() {
  Column() {
    AdaptiveLayoutItem()
  }
  .height(commonConstants.height)
  .justifyContent(FlexAlign.Center)
}