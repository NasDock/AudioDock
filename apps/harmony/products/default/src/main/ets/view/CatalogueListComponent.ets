import { commonConstants } from '../constants/CommonConstants';
import { CatalogueItemData } from '../viewmodel/CatalogueItemData';

@Builder
export function catalogueListComponent(uiContext: UIContext, catalogue: CatalogueItemData[] = []) {
  Column() {
    GridRow({
      columns: {
        xs: commonConstants.columnXs,
        sm: commonConstants.columnSm,
        md: commonConstants.columnMd,
        lg: commonConstants.columnLg
      }
    }) {
      GridCol({
        span: {
          xs: commonConstants.spanXs,
          sm: commonConstants.spanSm,
          md: commonConstants.spanMd,
          lg: commonConstants.spanLg
        },
        offset: {
          xs: commonConstants.offsetXs,
          sm: commonConstants.offsetSm,
          md: commonConstants.offsetMd,
          lg: commonConstants.offsetLg
        }
      }) {
        List() {
          ForEach(catalogue, (item: CatalogueItemData) => {
            ListItem() {
              Text(item.title)
                .fontSize($r('app.float.catalogue_text_font_size'))
                .fontColor($r('sys.color.ohos_id_color_text_primary_contrary'))
                .fontWeight(commonConstants.listFontWeight)
            }
            .backgroundColor($r('sys.color.ohos_id_color_emphasize'))
            .width(commonConstants.listItemWidth)
            .height($r('app.float.catalogue_list_item_height'))
            .margin({ bottom: $r('app.float.catalogue_list_item_margin_bottom') })
            .borderRadius($r('app.float.catalogue_list_item_border_radius'))
            .onClick(() => {
              uiContext.getRouter().pushUrl({
                url: item.uri,
                params: {
                  data: item.params
                }
              }).catch(() => {
                // handle error
              });
            })
          }, (item: CatalogueItemData) => item.id.toString())
        }
        .width(commonConstants.listWidth)
        .height($r('app.float.catalogue_list_height'))
        .scrollBar(BarState.Off)
      }
    }
  }
  .justifyContent(FlexAlign.Center)
  .alignItems(HorizontalAlign.Center)
  .height(commonConstants.columnHeight)
  .margin({
    left: $r('app.float.catalogue_list_margin_left'),
    right: $r('app.float.catalogue_list_margin_right')
  })
}