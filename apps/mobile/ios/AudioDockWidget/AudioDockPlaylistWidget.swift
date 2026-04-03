import WidgetKit
import SwiftUI

private let playlistWidgetKind = "AudioDockPlaylistWidget"
private let widgetSuite = "group.com.soundx.mobile"
private let playlistKey = "widget_playlists"

struct WidgetPlaylistItem: Identifiable {
  let id: String
  let name: String
  let cover: UIImage?
}

struct AudioDockPlaylistEntry: TimelineEntry {
  let date: Date
  let playlists: [WidgetPlaylistItem]
  let isPlaying: Bool
  let colorPrimary: Color
  let colorSecondary: Color
  let backgroundCover: UIImage?
  let isVip: Bool
}

struct AudioDockPlaylistProvider: TimelineProvider {
  func placeholder(in context: Context) -> AudioDockPlaylistEntry {
    AudioDockPlaylistEntry(
      date: Date(),
      playlists: [],
      isPlaying: false,
      colorPrimary: .black,
      colorSecondary: .black,
      backgroundCover: nil,
      isVip: true
    )
  }

  func getSnapshot(in context: Context, completion: @escaping (AudioDockPlaylistEntry) -> Void) {
    completion(loadEntry())
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<AudioDockPlaylistEntry>) -> Void) {
    let entry = loadEntry()
    let nextUpdate = Calendar.current.date(byAdding: .minute, value: 30, to: Date()) ?? Date().addingTimeInterval(1800)
    completion(Timeline(entries: [entry], policy: .after(nextUpdate)))
  }

  private func loadEntry() -> AudioDockPlaylistEntry {
    let defaults = UserDefaults(suiteName: widgetSuite)
    let primaryHex = defaults?.string(forKey: "widget_color_primary") ?? "#000000"
    let secondaryHex = defaults?.string(forKey: "widget_color_secondary") ?? "#000000"
    let playlists = loadPlaylists(defaults: defaults)
    let backgroundCover = playlists.first?.cover
    let isPlaying = defaults?.bool(forKey: "widget_is_playing") ?? false
    let isVip = defaults?.bool(forKey: "widget_is_vip") ?? false

    return AudioDockPlaylistEntry(
      date: Date(),
      playlists: playlists,
      isPlaying: isPlaying,
      colorPrimary: Color(hex: primaryHex),
      colorSecondary: Color(hex: secondaryHex),
      backgroundCover: backgroundCover,
      isVip: isVip
    )
  }

  private func loadPlaylists(defaults: UserDefaults?) -> [WidgetPlaylistItem] {
    guard let defaults,
          let data = defaults.data(forKey: playlistKey),
          let raw = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] else {
      return []
    }

    return raw.prefix(3).compactMap { item in
      let id = String(describing: item["id"] ?? "")
      let name = item["name"] as? String ?? "播放列表"
      let coverName = item["cover"] as? String ?? ""
      let cover = loadImageFromContainer(fileName: coverName)
      return WidgetPlaylistItem(id: id, name: name, cover: cover)
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

struct AudioDockPlaylistWidgetView: View {
  let entry: AudioDockPlaylistEntry

  var body: some View {
    Group {
      if entry.isVip {
        VStack(spacing: 10) {
          HStack {
            Text("播放列表")
              .font(.system(size: 15, weight: .bold))
            Spacer()
            headerPlayPause
          }

          VStack(spacing: 8) {
            ForEach(entry.playlists) { item in
              HStack(spacing: 10) {
                coverView(item.cover)
                  .frame(width: 44, height: 44)
                  .cornerRadius(8)
                Text(item.name)
                  .font(.system(size: 13, weight: .medium))
                  .lineLimit(1)
                  .frame(maxWidth: .infinity, alignment: .leading)
                playButton(for: item.id)
              }
            }
          }
          .frame(maxWidth: .infinity, alignment: .top)

          Spacer(minLength: 0)
        }
        .padding(14)
      } else {
        lockedView
      }
    }
    .foregroundColor(.white)
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    .modifier(WidgetBackground(primary: entry.colorPrimary, secondary: entry.colorSecondary, cover: entry.isVip ? entry.backgroundCover : nil))
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

  private func coverView(_ image: UIImage?) -> some View {
    Group {
      if let image {
        Image(uiImage: image)
          .resizable()
          .scaledToFill()
      } else {
        ZStack {
          Color.white.opacity(0.12)
          Image(systemName: "music.note.list")
            .font(.system(size: 16, weight: .semibold))
            .foregroundColor(.white.opacity(0.85))
        }
      }
    }
    .clipped()
  }

  private func playButton(for id: String) -> some View {
    if #available(iOS 17.0, *) {
      return AnyView(
        Button(intent: WidgetPlayPlaylistIntent(playlistId: id)) {
          Image(systemName: "play.fill")
            .font(.system(size: 16, weight: .semibold))
            .frame(width: 28, height: 28)
        }
        .buttonStyle(.plain)
      )
    } else {
      let url = URL(string: "audiodock://?action=play_playlist&id=\(id)")
      return AnyView(
        Link(destination: url!) {
          Image(systemName: "play.fill")
            .font(.system(size: 16, weight: .semibold))
            .frame(width: 28, height: 28)
        }
      )
    }
  }

  @ViewBuilder
  private var headerPlayPause: some View {
    if entry.isPlaying {
      if #available(iOS 17.0, *) {
        Button(intent: WidgetControlIntent(action: .pause)) {
          Image(systemName: "pause.fill")
            .font(.system(size: 16, weight: .semibold))
            .frame(width: 28, height: 28)
        }
        .buttonStyle(.plain)
      } else {
        let url = URL(string: "audiodock://?action=pause")
        Link(destination: url!) {
          Image(systemName: "pause.fill")
            .font(.system(size: 16, weight: .semibold))
            .frame(width: 28, height: 28)
        }
      }
    } else {
      let firstId = entry.playlists.first?.id ?? ""
      if #available(iOS 17.0, *) {
        Button(intent: WidgetPlayPlaylistIntent(playlistId: firstId)) {
          Image(systemName: "play.fill")
            .font(.system(size: 16, weight: .semibold))
            .frame(width: 28, height: 28)
        }
        .buttonStyle(.plain)
      } else {
        let url = URL(string: "audiodock://?action=play_playlist&id=\(firstId)")
        Link(destination: url!) {
          Image(systemName: "play.fill")
            .font(.system(size: 16, weight: .semibold))
            .frame(width: 28, height: 28)
        }
      }
    }
  }
}

struct AudioDockPlaylistWidget: Widget {
  let kind: String = playlistWidgetKind

  var body: some WidgetConfiguration {
    StaticConfiguration(kind: kind, provider: AudioDockPlaylistProvider()) { entry in
      AudioDockPlaylistWidgetView(entry: entry)
    }
    .configurationDisplayName("播放列表")
    .description("快速播放你的播放列表")
    .supportedFamilies([.systemLarge])
  }
}
