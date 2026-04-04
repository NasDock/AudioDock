import { commonConstants } from '../constants/CommonConstants';
import { TabBarItem } from './TabBarItem';

/**
 * Binds data to components and provides interfaces.
 */
export class TabsViewModel {
  /**
   * Get item information for the tab.
   *
   * @return {Array<TabBarItem>} tabItems
   */
  getTabData(): TabBarItem[] {
    const tabItems: TabBarItem[] = [];
    for (let i = 0; i < commonConstants.tabSize; i++) {
      const itemInfo: TabBarItem = new TabBarItem();
      itemInfo.id = i;
      itemInfo.name = $r('app.string.tab_name');
      itemInfo.icon = $r('app.media.ic_tabs_icon');
      itemInfo.selectIcon = $r('app.media.ic_tabs_icon_selected');
      tabItems.push(itemInfo);
    }
    return tabItems;
  }
}

const tabsViewModel = new TabsViewModel();

export default tabsViewModel;