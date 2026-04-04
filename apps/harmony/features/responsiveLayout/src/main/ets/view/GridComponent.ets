import { BreakPointType } from '@ohos/common';
import { commonConstants } from '../constants/CommonConstants';

/**
 * Grid component.
 */
@Component
export struct GridComponent {
  @StorageProp('mainBreakpoint') currentBreakpoint: string = commonConstants.breakpointsInitializeName;
  @State colTemplate: string = commonConstants.initializeTemplate;
  private readonly data: number[] = [];

  aboutToAppear() {
    for (let i = 0; i < commonConstants.gridSize; i++) {
      this.data.push(i);
    }
    switch (this.currentBreakpoint) {
      case commonConstants.breakpointsSmName:
        this.colTemplate = commonConstants.smColTemplate;
        break;
      case commonConstants.breakpointsMdName:
        this.colTemplate = commonConstants.mdColTemplate;
        break;
      case commonConstants.breakpointsLgName:
        this.colTemplate = commonConstants.lgColTemplate;
        break;
      case commonConstants.breakpointsXlName:
        this.colTemplate = commonConstants.xlColTemplate;
        break;
      default:
        this.colTemplate = commonConstants.smColTemplate;
        break;
    }
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
        .margin({ left: $r('app.float.arrow_margin_left') })
        .backgroundColor($r('sys.color.ohos_id_color_button_normal'))
      }
      .width(commonConstants.rowWidth)
      .height($r('app.float.arrow_item_height'))

      Grid() {
        ForEach(this.data, () => {
          GridItem() {
            Column() {
              Row()
                .width(commonConstants.rowWidth)
                .aspectRatio(commonConstants.columnAspectRatio)
                .backgroundColor($r('sys.color.ohos_id_color_component_normal'))
                .borderRadius($r('app.float.grid_row_border_radius'))

              Row() {
                Text($r('app.string.grid_title_label'))
                  .margin({ top: $r('app.float.grid_text_top') })
                  .fontSize($r('app.float.grid_text_font_size'))
                  .fontWeight(commonConstants.columnTextFontWeight)
                  .fontColor($r('sys.color.ohos_id_color_text_primary'))
              }
              .padding({ left: $r('app.float.grid_text_padding_left') })
              .width(commonConstants.rowWidth)
            }
          }
        }, (item: number) => item.toString())
      }
      .columnsGap($r('app.float.grid_column_gap'))
      .rowsGap($r('app.float.grid_row_gap'))
      .columnsTemplate(this.colTemplate)
      .onAreaChange(() => {
        this.colTemplate = new BreakPointType({
          sm: commonConstants.smColTemplate,
          md: commonConstants.mdColTemplate,
          lg: commonConstants.lgColTemplate,
          xl: commonConstants.xlColTemplate
        }).getValue(this.currentBreakpoint);
      })
      .margin({
        left: $r('app.float.grid_margin_left'),
        right: $r('app.float.grid_margin_right')
      })
      .padding({ bottom: $r('app.float.grid_padding_bottom') })
      .scrollBar(BarState.Off)
    }
  }
}