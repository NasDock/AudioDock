import { RESPONSIVE_ROUTE, ADAPTIVE_ROUTE, SYSTEM_CAPABILITIES_ROUTE } from '../constants/RouteConstants';
import { CatalogueItemData } from './CatalogueItemData';

/**
 * Catalogue list page view model.
 */
class CatalogueViewModel {
  /**
   * Get Catalogue data.
   *
   * @return {Array<CatalogueItemData>} CatalogueData.
   */
  getCatalogueData(): CatalogueItemData[] {
    const catalogueData: CatalogueItemData[] =
      [new CatalogueItemData(0, $r('app.string.responsive_layout'), RESPONSIVE_ROUTE),
        new CatalogueItemData(1, $r('app.string.adaptive_layout'), ADAPTIVE_ROUTE),
        new CatalogueItemData(2, $r('app.string.system_cap'), SYSTEM_CAPABILITIES_ROUTE)];
    return catalogueData;
  }
}

const catalogueViewModel = new CatalogueViewModel();

export default catalogueViewModel;