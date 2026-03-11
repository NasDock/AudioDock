import Foundation
import React
import WidgetKit

@objc(WidgetBridge)
class WidgetBridge: NSObject, RCTBridgeModule {
  static func moduleName() -> String! {
    return "WidgetBridge"
  }

  static func requiresMainQueueSetup() -> Bool {
    return false
  }

  private static let suiteName = "group.com.soundx.mobile"
  private static let coverFileKey = "widget_cover_file"

  @objc(updateWidget:resolver:rejecter:)
  func updateWidget(
    _ payload: NSDictionary,
    resolver resolve: RCTPromiseResolveBlock,
    rejecter reject: RCTPromiseRejectBlock
  ) {
    guard let defaults = UserDefaults(suiteName: Self.suiteName) else {
      reject("WIDGET_STORE_UNAVAILABLE", "App group UserDefaults unavailable", nil)
      return
    }

    let title = payload["title"] as? String ?? "未在播放"
    let artist = payload["artist"] as? String ?? ""
    let isPlaying = payload["isPlaying"] as? Bool ?? false

    defaults.set(title, forKey: "widget_title")
    defaults.set(artist, forKey: "widget_artist")
    defaults.set(isPlaying, forKey: "widget_is_playing")

    if let coverPath = payload["coverPath"] as? String, !coverPath.isEmpty {
      let normalizedPath = coverPath.hasPrefix("file://")
        ? String(coverPath.dropFirst("file://".count))
        : coverPath
      let sourceURL = URL(fileURLWithPath: normalizedPath)
      if let containerURL = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: Self.suiteName) {
        let destinationURL = containerURL.appendingPathComponent("widget_cover.jpg")
        do {
          if FileManager.default.fileExists(atPath: destinationURL.path) {
            try FileManager.default.removeItem(at: destinationURL)
          }
          try FileManager.default.copyItem(at: sourceURL, to: destinationURL)
          defaults.set(destinationURL.lastPathComponent, forKey: Self.coverFileKey)
        } catch {
          defaults.removeObject(forKey: Self.coverFileKey)
        }
      }
    } else {
      defaults.removeObject(forKey: Self.coverFileKey)
    }

    WidgetCenter.shared.reloadTimelines(ofKind: "AudioDockWidget")
    resolve(nil)
  }
}
