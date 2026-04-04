import { catalogueListComponent } from '../view/CatalogueListComponent';
import CatalogueViewModel from '../viewmodel/CatalogueViewModel';

/**
 * Index is the entry of application and Here is a list showing three buttons,
 * click the button to jump to different pages.
 */
@Entry
@Component
struct Index {
  build() {
    Column() {
      catalogueListComponent(this.getUIContext(), CatalogueViewModel.getCatalogueData());
    }
    .backgroundColor($r('sys.color.ohos_id_color_sub_background'))
  }
}