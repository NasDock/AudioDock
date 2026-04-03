import WidgetKit
import SwiftUI

private let playerHistoryWidgetKind = "AudioDockPlayerHistoryWidget"
private let widgetSuite = "group.com.soundx.mobile"
private let historyKey = "widget_history"

struct WidgetHistoryItem: Identifiable {
  let id: String
  let title: String
  let artist: String
  let cover: UIImage?
}

struct AudioDockPlayerHistoryEntry: TimelineEntry {
  let date: Date
  let title: String
  let artist: String
  let isPlaying: Bool
  let cover: UIImage?
  let history: [WidgetHistoryItem]
  let colorPrimary: Color
  let colorSecondary: Color
  let isVip: Bool
}

struct AudioDockPlayerHistoryProvider: TimelineProvider {
  func placeholder(in context: Context) -> AudioDockPlayerHistoryEntry {
    AudioDockPlayerHistoryEntry(
      date: Date(),
      title: "未在播放",
      artist: "",
      isPlaying: false,
      cover: nil,
      history: [],
      colorPrimary: .black,
      colorSecondary: .black,
      isVip: true
    )
  }

  func getSnapshot(in context: Context, completion: @escaping (AudioDockPlayerHistoryEntry) -> Void) {
    completion(loadEntry())
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<AudioDockPlayerHistoryEntry>) -> Void) {
    let entry = loadEntry()
    let nextUpdate = Calendar.current.date(byAdding: .minute, value: 15, to: Date()) ?? Date().addingTimeInterval(900)
    completion(Timeline(entries: [entry], policy: .after(nextUpdate)))
  }

  private func loadEntry() -> AudioDockPlayerHistoryEntry {
    let defaults = UserDefaults(suiteName: widgetSuite)
    let title = defaults?.string(forKey: "widget_title") ?? "未在播放"
    let artist = defaults?.string(forKey: "widget_artist") ?? ""
    let isPlaying = defaults?.bool(forKey: "widget_is_playing") ?? false
    let primaryHex = defaults?.string(forKey: "widget_color_primary") ?? "#000000"
    let secondaryHex = defaults?.string(forKey: "widget_color_secondary") ?? "#000000"
    let cover = loadCover(defaults: defaults)
    let history = loadHistory(defaults: defaults)
    let isVip = defaults?.bool(forKey: "widget_is_vip") ?? false

    return AudioDockPlayerHistoryEntry(
      date: Date(),
      title: title,
      artist: artist,
      isPlaying: isPlaying,
      cover: cover,
      history: history,
      colorPrimary: Color(hex: primaryHex),
      colorSecondary: Color(hex: secondaryHex),
      isVip: isVip
    )
  }

  private func loadCover(defaults: UserDefaults?) -> UIImage? {
    guard let defaults,
          let coverName = defaults.string(forKey: "widget_cover_file"),
          let containerURL = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: widgetSuite) else {
      return nil
    }
    let coverURL = containerURL.appendingPathComponent(coverName)
    guard let data = try? Data(contentsOf: coverURL) else { return nil }
    return UIImage(data: data)
  }

  private func loadHistory(defaults: UserDefaults?) -> [WidgetHistoryItem] {
    guard let defaults,
          let data = defaults.data(forKey: historyKey),
          let raw = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] else {
      return []
    }

    return raw.prefix(3).compactMap { item in
      let id = String(describing: item["id"] ?? "")
      let title = item["title"] as? String ?? "未命名"
      let artist = item["artist"] as? String ?? ""
      let coverName = item["cover"] as? String ?? ""
      let cover = loadImageFromContainer(fileName: coverName)
      return WidgetHistoryItem(id: id, title: title, artist: artist, cover: cover)
    }
  }

  private func loadImageFromContainer(fileName: String) -> UIImage? {
    guard !fileName.isEmpty,
          let containerURL = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: widgetSuite) else {
      return nil
    }
    let url = containerURL.appendingPathComponent(fileName)
    guard let data = try? Data(contentsOf: url) else { return nil }
    return UIImage(data: data)
  }
}

struct AudioDockPlayerHistoryWidgetView: View {
  let entry: AudioDockPlayerHistoryEntry

  var body: some View {
    Group {
      if entry.isVip {
        VStack(spacing: 10) {
          topPlayerView
          historyListView
        }
        .padding(14)
      } else {
        lockedView
      }
    }
    .foregroundColor(.white)
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    .modifier(WidgetBackground(primary: entry.colorPrimary, secondary: entry.colorSecondary, cover: entry.isVip ? entry.cover : nil))
    .widgetURL(URL(string: entry.isVip ? "audiodock://" : "audiodock://member-benefits"))
  }

  private var lockedView: some View {
    VStack(spacing: 12) {
      Image(systemName: "crown.fill")
        .font(.system(size: 24))
        .foregroundColor(.yellow)
      Text("会员专属功能")
        .font(.system(size: 14, weight: .bold))
      Text("请在 App 中开通会员")
        .font(.system(size: 11))
        .opacity(0.7)
    }
    .padding()
    .multilineTextAlignment(.center)
    .frame(maxHeight: .infinity)
  }

  private var topPlayerView: some View {
    HStack(alignment: .top, spacing: 10) {
      coverView(entry.cover)
        .frame(width: 96, height: 96)
        .cornerRadius(12)

      VStack(spacing: 6) {
        Text(entry.title)
          .font(.system(size: 14, weight: .semibold))
          .lineLimit(1)
          .frame(maxWidth: .infinity, alignment: .center)
        Text(entry.artist)
          .font(.system(size: 12))
          .foregroundColor(.white.opacity(0.7))
          .lineLimit(1)
          .frame(maxWidth: .infinity, alignment: .center)
        controlsView
      }
      .frame(maxWidth: .infinity, alignment: .topLeading)
    }
    .frame(maxWidth: .infinity, alignment: .topLeading)
  }

  private var historyListView: some View {
    VStack(spacing: 8) {
      ForEach(entry.history) { item in
        HStack(spacing: 10) {
          coverView(item.cover)
            .frame(width: 40, height: 40)
            .cornerRadius(8)
          VStack(alignment: .leading, spacing: 2) {
            Text(item.title)
              .font(.system(size: 12, weight: .medium))
              .lineLimit(1)
            Text(item.artist)
              .font(.system(size: 11))
              .foregroundColor(.white.opacity(0.7))
              .lineLimit(1)
          }
          .frame(maxWidth: .infinity, alignment: .leading)
          playHistoryButton(for: item.id)
        }
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
  }

  private var controlsView: some View {
    HStack(spacing: 16) {
      controlButton(systemName: "backward.end.fill", action: "prev")
      controlButton(systemName: entry.isPlaying ? "pause.fill" : "play.fill", action: entry.isPlaying ? "pause" : "play")
      controlButton(systemName: "forward.end.fill", action: "next")
    }
  }

  private func coverView(_ image: UIImage?) -> some View {
    Group {
      if let image {
        Image(uiImage: image)
          .resizable()
          .scaledToFill()
      } else {
        ZStack {
          Color.white.opacity(0.08)
          Image(systemName: "music.note")
            .font(.system(size: 16, weight: .semibold))
            .foregroundColor(.white.opacity(0.85))
        }
      }
    }
    .clipped()
  }

  @ViewBuilder
  private func controlButton(systemName: String, action: String) -> some View {
    if #available(iOS 17.0, *) {
      let widgetAction = WidgetAction(rawValue: action) ?? .play
      Button(intent: WidgetControlIntent(action: widgetAction)) {
        Image(systemName: systemName)
          .font(.system(size: 16, weight: .semibold))
          .frame(width: 24, height: 24)
      }
      .buttonStyle(.plain)
    } else {
      let url = URL(string: "audiodock://?action=\(action)")
      Link(destination: url!) {
        Image(systemName: systemName)
          .font(.system(size: 16, weight: .semibold))
          .frame(width: 24, height: 24)
      }
    }
  }

  private func playHistoryButton(for id: String) -> some View {
    if #available(iOS 17.0, *) {
      return AnyView(
        Button(intent: WidgetPlayHistoryIntent(trackId: id)) {
          Image(systemName: "play.fill")
            .font(.system(size: 14, weight: .semibold))
            .frame(width: 26, height: 26)
        }
        .buttonStyle(.plain)
      )
    } else {
      let url = URL(string: "audiodock://?action=play_history&id=\(id)")
      return AnyView(
        Link(destination: url!) {
          Image(systemName: "play.fill")
            .font(.system(size: 14, weight: .semibold))
            .frame(width: 26, height: 26)
        }
      )
    }
  }
}

struct AudioDockPlayerHistoryWidget: Widget {
  let kind: String = playerHistoryWidgetKind

  var body: some WidgetConfiguration {
    StaticConfiguration(kind: kind, provider: AudioDockPlayerHistoryProvider()) { entry in
      AudioDockPlayerHistoryWidgetView(entry: entry)
    }
    .configurationDisplayName("播放与听过")
    .description("控制播放并查看最近听过")
    .supportedFamilies([.systemLarge])
  }
}
