import WidgetKit
import SwiftUI

@main
struct AudioDockWidgetBundle: WidgetBundle {
  @WidgetBundleBuilder
  var body: some Widget {
    AudioDockWidget()
    AudioDockPlaylistWidget()
    AudioDockPlayerHistoryWidget()
    AudioDockLatestWidget()
  }
}
