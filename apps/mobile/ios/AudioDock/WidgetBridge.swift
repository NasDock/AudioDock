import Foundation
import UIKit
import WidgetKit

@objc(WidgetBridge)
class WidgetBridge: NSObject {
  @objc static func requiresMainQueueSetup() -> Bool {
    false
  }

  private static let suiteName = "group.com.audiodock.app"
  private static let coverFileKey = "widget_cover_file"
  private static let colorPrimaryKey = "widget_color_primary"
  private static let colorSecondaryKey = "widget_color_secondary"
  private static let playModeKey = "widget_play_mode"
  private static let playModeOverrideKey = "widget_play_mode_override"
  private static let playModeOverrideUntilKey = "widget_play_mode_override_until"
  private static let likedKey = "widget_is_liked"
  private static let playlistsKey = "widget_playlists"
  private static let historyKey = "widget_history"
  private static let latestKey = "widget_latest_tracks"
  private static let vipKey = "widget_is_vip"

  @objc(updateWidget:resolver:rejecter:)
  func updateWidget(
    _ payload: NSDictionary,
    resolver resolve: RCTPromiseResolveBlock,
    rejecter reject: RCTPromiseRejectBlock
  ) {
    guard let defaults = UserDefaults(suiteName: Self.suiteName) else {
      print("[WidgetBridge][iOS] updateWidget failed: UserDefaults unavailable for suite \(Self.suiteName)")
      reject("WIDGET_STORE_UNAVAILABLE", "App group UserDefaults unavailable", nil)
      return
    }

    let title = payload["title"] as? String ?? "未在播放"
    let artist = payload["artist"] as? String ?? ""
    let isPlaying = payload["isPlaying"] as? Bool ?? false
    let playMode = payload["playMode"] as? String ?? ""
    let isLiked = payload["isLiked"] as? Bool ?? false
    defaults.set(title, forKey: "widget_title")
    defaults.set(artist, forKey: "widget_artist")
    defaults.set(isPlaying, forKey: "widget_is_playing")
    let overrideUntil = defaults.double(forKey: Self.playModeOverrideUntilKey)
    if overrideUntil <= Date().timeIntervalSince1970 {
      defaults.set(playMode, forKey: Self.playModeKey)
    }
    defaults.set(isLiked, forKey: Self.likedKey)
    if payload.object(forKey: "isVip") != nil {
      let isVip = (payload["isVip"] as? Bool) ?? ((payload["isVip"] as? NSNumber)?.boolValue ?? false)
      defaults.set(isVip, forKey: Self.vipKey)
      print("[WidgetBridge][iOS] updateWidget wrote isVip=\(isVip)")
    }

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
          if let image = UIImage(contentsOfFile: destinationURL.path) {
            let primary = Self.averageColor(from: image) ?? UIColor.black
            let secondary = primary.darker(by: 0.45)
            defaults.set(primary.toHexString(), forKey: Self.colorPrimaryKey)
            defaults.set(secondary.toHexString(), forKey: Self.colorSecondaryKey)
          }
        } catch {
          defaults.removeObject(forKey: Self.coverFileKey)
        }
      }
    } else {
      defaults.removeObject(forKey: Self.coverFileKey)
      defaults.set("#000000", forKey: Self.colorPrimaryKey)
      defaults.set("#000000", forKey: Self.colorSecondaryKey)
    }

    defaults.synchronize()
    print("[WidgetBridge][iOS] updateWidget synchronized. current isVip=\(defaults.bool(forKey: Self.vipKey))")
    WidgetCenter.shared.reloadTimelines(ofKind: "AudioDockWidget")
    WidgetCenter.shared.reloadTimelines(ofKind: "AudioDockPlaylistWidget")
    WidgetCenter.shared.reloadTimelines(ofKind: "AudioDockPlayerHistoryWidget")
    WidgetCenter.shared.reloadTimelines(ofKind: "AudioDockLatestWidget")
    resolve(nil)
  }

  @objc(updateWidgetMembership:resolver:rejecter:)
  func updateWidgetMembership(
    _ payload: NSDictionary,
    resolver resolve: RCTPromiseResolveBlock,
    rejecter reject: RCTPromiseRejectBlock
  ) {
    guard let defaults = UserDefaults(suiteName: Self.suiteName) else {
      print("[WidgetBridge][iOS] updateWidgetMembership failed: UserDefaults unavailable for suite \(Self.suiteName)")
      reject("WIDGET_STORE_UNAVAILABLE", "App group UserDefaults unavailable", nil)
      return
    }

    let isVip = (payload["isVip"] as? Bool) ?? ((payload["isVip"] as? NSNumber)?.boolValue ?? false)
    defaults.set(isVip, forKey: Self.vipKey)

    defaults.synchronize()
    print("[WidgetBridge][iOS] updateWidgetMembership wrote isVip=\(isVip), synchronized value=\(defaults.bool(forKey: Self.vipKey))")
    WidgetCenter.shared.reloadAllTimelines()
    resolve(nil)
  }

  @objc(updateWidgetCollections:resolver:rejecter:)
  func updateWidgetCollections(
    _ payload: NSDictionary,
    resolver resolve: RCTPromiseResolveBlock,
    rejecter reject: RCTPromiseRejectBlock
  ) {
    guard let defaults = UserDefaults(suiteName: Self.suiteName) else {
      print("[WidgetBridge][iOS] updateWidgetCollections failed: UserDefaults unavailable for suite \(Self.suiteName)")
      reject("WIDGET_STORE_UNAVAILABLE", "App group UserDefaults unavailable", nil)
      return
    }

    let playlists = payload["playlists"] as? [NSDictionary] ?? []
    let history = payload["history"] as? [NSDictionary] ?? []
    let latest = payload["latest"] as? [NSDictionary] ?? []
    let storedPlaylists = playlists.compactMap { item -> [String: Any]? in
      guard let rawId = item["id"] else { return nil }
      let name = item["name"] as? String ?? "播放列表"
      let coverFile = storeCoverIfNeeded(item["coverPath"] as? String, nameHint: "playlist_\(rawId)")
      return [
        "id": rawId,
        "name": name,
        "cover": coverFile ?? ""
      ]
    }

    let storedHistory = history.compactMap { item -> [String: Any]? in
      guard let rawId = item["id"] else { return nil }
      let title = item["title"] as? String ?? "未命名"
      let artist = item["artist"] as? String ?? ""
      let album = item["album"] as? String ?? ""
      let type = item["type"] as? String ?? ""
      let coverFile = storeCoverIfNeeded(item["coverPath"] as? String, nameHint: "history_\(rawId)")
      return [
        "id": rawId,
        "title": title,
        "artist": artist,
        "album": album,
        "type": type,
        "cover": coverFile ?? ""
      ]
    }

    let storedLatest = latest.compactMap { item -> [String: Any]? in
      guard let rawId = item["id"] else { return nil }
      let title = item["title"] as? String ?? "未命名"
      let artist = item["artist"] as? String ?? ""
      let type = item["type"] as? String ?? ""
      let coverFile = storeCoverIfNeeded(item["coverPath"] as? String, nameHint: "latest_\(rawId)")
      return [
        "id": rawId,
        "title": title,
        "artist": artist,
        "type": type,
        "cover": coverFile ?? ""
      ]
    }

    if let data = try? JSONSerialization.data(withJSONObject: storedPlaylists) {
      defaults.set(data, forKey: Self.playlistsKey)
    }
    if let data = try? JSONSerialization.data(withJSONObject: storedHistory) {
      defaults.set(data, forKey: Self.historyKey)
    }
    if let data = try? JSONSerialization.data(withJSONObject: storedLatest) {
      defaults.set(data, forKey: Self.latestKey)
    }
    if payload.object(forKey: "isVip") != nil {
      let isVip = (payload["isVip"] as? Bool) ?? ((payload["isVip"] as? NSNumber)?.boolValue ?? false)
      defaults.set(isVip, forKey: Self.vipKey)
      print("[WidgetBridge][iOS] updateWidgetCollections wrote isVip=\(isVip)")
    }

    defaults.synchronize()
    print("[WidgetBridge][iOS] updateWidgetCollections synchronized. current isVip=\(defaults.bool(forKey: Self.vipKey))")
    WidgetCenter.shared.reloadTimelines(ofKind: "AudioDockWidget")
    WidgetCenter.shared.reloadTimelines(ofKind: "AudioDockPlaylistWidget")
    WidgetCenter.shared.reloadTimelines(ofKind: "AudioDockPlayerHistoryWidget")
    WidgetCenter.shared.reloadTimelines(ofKind: "AudioDockLatestWidget")
    resolve(nil)
  }

  private func storeCoverIfNeeded(_ coverPath: String?, nameHint: String) -> String? {
    guard let coverPath, !coverPath.isEmpty else { return nil }
    let normalizedPath = coverPath.hasPrefix("file://")
      ? String(coverPath.dropFirst("file://".count))
      : coverPath
    let sourceURL = URL(fileURLWithPath: normalizedPath)
    guard let containerURL = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: Self.suiteName) else {
      return nil
    }
    let ext = sourceURL.pathExtension.isEmpty ? "jpg" : sourceURL.pathExtension
    let fileName = "\(nameHint).\(ext)"
    let destinationURL = containerURL.appendingPathComponent(fileName)
    do {
      if FileManager.default.fileExists(atPath: destinationURL.path) {
        try FileManager.default.removeItem(at: destinationURL)
      }
      try FileManager.default.copyItem(at: sourceURL, to: destinationURL)
      return destinationURL.lastPathComponent
    } catch {
      return nil
    }
  }

  private static func averageColor(from image: UIImage) -> UIColor? {
    guard let cgImage = image.cgImage else { return nil }
    let width = 8
    let height = 8
    let bytesPerRow = width * 4
    let colorSpace = CGColorSpaceCreateDeviceRGB()
    var pixelData = [UInt8](repeating: 0, count: width * height * 4)
    guard let context = CGContext(
      data: &pixelData,
      width: width,
      height: height,
      bitsPerComponent: 8,
      bytesPerRow: bytesPerRow,
      space: colorSpace,
      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
    ) else { return nil }

    context.draw(cgImage, in: CGRect(x: 0, y: 0, width: width, height: height))

    var r: Int = 0
    var g: Int = 0
    var b: Int = 0
    let count = width * height
    for i in 0..<count {
      let index = i * 4
      r += Int(pixelData[index])
      g += Int(pixelData[index + 1])
      b += Int(pixelData[index + 2])
    }

    return UIColor(
      red: CGFloat(r) / CGFloat(count) / 255.0,
      green: CGFloat(g) / CGFloat(count) / 255.0,
      blue: CGFloat(b) / CGFloat(count) / 255.0,
      alpha: 1.0
    )
  }
}

private extension UIColor {
  func darker(by percentage: CGFloat) -> UIColor {
    var r: CGFloat = 0
    var g: CGFloat = 0
    var b: CGFloat = 0
    var a: CGFloat = 0
    guard getRed(&r, green: &g, blue: &b, alpha: &a) else { return self }
    return UIColor(
      red: max(r - percentage, 0),
      green: max(g - percentage, 0),
      blue: max(b - percentage, 0),
      alpha: a
    )
  }

  func toHexString() -> String {
    var r: CGFloat = 0
    var g: CGFloat = 0
    var b: CGFloat = 0
    var a: CGFloat = 0
    getRed(&r, green: &g, blue: &b, alpha: &a)
    let rgb = (Int(r * 255) << 16) | (Int(g * 255) << 8) | Int(b * 255)
    return String(format: "#%06X", rgb)
  }
}
