import WidgetKit
import SwiftUI

private let latestWidgetKind = "AudioDockLatestWidget"
private let widgetSuite = "group.com.soundx.mobile"
private let latestKey = "widget_latest_tracks"

struct WidgetLatestItem: Identifiable {
  let id: String
  let title: String
  let artist: String
  let cover: UIImage?
}

struct AudioDockLatestEntry: TimelineEntry {
  let date: Date
  let items: [WidgetLatestItem]
  let isPlaying: Bool
  let colorPrimary: Color
  let colorSecondary: Color
  let backgroundCover: UIImage?
}

struct AudioDockLatestProvider: TimelineProvider {
  func placeholder(in context: Context) -> AudioDockLatestEntry {
    AudioDockLatestEntry(
      date: Date(),
      items: [],
      isPlaying: false,
      colorPrimary: .black,
      colorSecondary: .black,
      backgroundCover: nil
    )
  }

  func getSnapshot(in context: Context, completion: @escaping (AudioDockLatestEntry) -> Void) {
    completion(loadEntry())
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<AudioDockLatestEntry>) -> Void) {
    let entry = loadEntry()
    let nextUpdate = Calendar.current.date(byAdding: .minute, value: 30, to: Date()) ?? Date().addingTimeInterval(1800)
    completion(Timeline(entries: [entry], policy: .after(nextUpdate)))
  }

  private func loadEntry() -> AudioDockLatestEntry {
    let defaults = UserDefaults(suiteName: widgetSuite)
    let primaryHex = defaults?.string(forKey: "widget_color_primary") ?? "#000000"
    let secondaryHex = defaults?.string(forKey: "widget_color_secondary") ?? "#000000"
    let isPlaying = defaults?.bool(forKey: "widget_is_playing") ?? false
    let items = loadLatest(defaults: defaults)
    let backgroundCover = items.first?.cover

    return AudioDockLatestEntry(
      date: Date(),
      items: items,
      isPlaying: isPlaying,
      colorPrimary: Color(hex: primaryHex),
      colorSecondary: Color(hex: secondaryHex),
      backgroundCover: backgroundCover
    )
  }

  private func loadLatest(defaults: UserDefaults?) -> [WidgetLatestItem] {
    guard let defaults,
          let data = defaults.data(forKey: latestKey),
          let raw = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] else {
      return []
    }

    return raw.prefix(5).compactMap { item in
      let id = String(describing: item["id"] ?? "")
      let title = item["title"] as? String ?? "未命名"
      let artist = item["artist"] as? String ?? ""
      let coverName = item["cover"] as? String ?? ""
      let cover = loadImageFromContainer(fileName: coverName)
      return WidgetLatestItem(id: id, title: title, artist: artist, cover: cover)
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

struct AudioDockLatestWidgetView: View {
  let entry: AudioDockLatestEntry

  var body: some View {
    VStack(spacing: 10) {
      HStack {
        Text("上新单曲")
          .font(.system(size: 15, weight: .bold))
        Spacer()
        headerPlayPause
        headerRefresh
      }

      VStack(spacing: 8) {
        ForEach(entry.items) { item in
          HStack(spacing: 10) {
            coverView(item.cover)
              .frame(width: 40, height: 40)
              .cornerRadius(8)
            VStack(alignment: .leading, spacing: 2) {
              Text(item.title)
                .font(.system(size: 13, weight: .medium))
                .lineLimit(1)
              Text(item.artist)
                .font(.system(size: 11))
                .foregroundColor(.white.opacity(0.7))
                .lineLimit(1)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            playButton(for: item.id)
          }
        }
      }
      .frame(maxWidth: .infinity, alignment: .top)

      Spacer(minLength: 0)
    }
    .foregroundColor(.white)
    .padding(14)
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    .modifier(WidgetBackground(primary: entry.colorPrimary, secondary: entry.colorSecondary, cover: entry.backgroundCover))
    .widgetURL(URL(string: "audiodock://widget?open=player"))
  }

  private func coverView(_ image: UIImage?) -> some View {
    Group {
      if let image {
        Image(uiImage: image)
          .resizable()
          .scaledToFill()
      } else {
        ZStack {
          Color.white.opacity(0.12)
          Image(systemName: "music.note")
            .font(.system(size: 14, weight: .semibold))
            .foregroundColor(.white.opacity(0.85))
        }
      }
    }
    .clipped()
  }

  private func playButton(for id: String) -> some View {
    if #available(iOS 17.0, *) {
      return AnyView(
        Button(intent: WidgetPlayLatestIntent(trackId: id)) {
          Image(systemName: "play.fill")
            .font(.system(size: 14, weight: .semibold))
            .frame(width: 26, height: 26)
        }
        .buttonStyle(.plain)
      )
    } else {
      let url = URL(string: "audiodock://widget?action=play_latest&id=\(id)&open=player")
      return AnyView(
        Link(destination: url!) {
          Image(systemName: "play.fill")
            .font(.system(size: 14, weight: .semibold))
            .frame(width: 26, height: 26)
        }
      )
    }
  }

  @ViewBuilder
  private var headerPlayPause: some View {
    if #available(iOS 17.0, *) {
      let action: WidgetAction = entry.isPlaying ? .pause : .play
      Button(intent: WidgetControlIntent(action: action)) {
        Image(systemName: entry.isPlaying ? "pause.fill" : "play.fill")
          .font(.system(size: 16, weight: .semibold))
          .frame(width: 28, height: 28)
      }
      .buttonStyle(.plain)
    } else {
      let action = entry.isPlaying ? "pause" : "play"
      let url = URL(string: "audiodock://widget?action=\(action)&open=player")
      Link(destination: url!) {
        Image(systemName: entry.isPlaying ? "pause.fill" : "play.fill")
          .font(.system(size: 16, weight: .semibold))
          .frame(width: 28, height: 28)
      }
    }
  }

  @ViewBuilder
  private var headerRefresh: some View {
    if #available(iOS 17.0, *) {
      Button(intent: WidgetRefreshLatestIntent()) {
        Image(systemName: "arrow.clockwise")
          .font(.system(size: 15, weight: .semibold))
          .frame(width: 28, height: 28)
      }
      .buttonStyle(.plain)
    } else {
      let url = URL(string: "audiodock://widget?action=refresh_latest&open=player")
      Link(destination: url!) {
        Image(systemName: "arrow.clockwise")
          .font(.system(size: 15, weight: .semibold))
          .frame(width: 28, height: 28)
      }
    }
  }
}

struct AudioDockLatestWidget: Widget {
  let kind: String = latestWidgetKind

  var body: some WidgetConfiguration {
    StaticConfiguration(kind: kind, provider: AudioDockLatestProvider()) { entry in
      AudioDockLatestWidgetView(entry: entry)
    }
    .configurationDisplayName("上新单曲")
    .description("查看最新上新单曲")
    .supportedFamilies([.systemLarge])
  }
}
