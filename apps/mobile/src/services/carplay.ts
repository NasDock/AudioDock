import { Platform } from "react-native";
import {
  getAlbumTracks,
  getLatestTracks,
  getPlaylistById,
  getPlaylists,
  getRecommendedAlbums,
  getTrackHistory,
} from "@soundx/services";
import type { Album, Playlist, Track } from "../models";
import { getImageUrl } from "../utils/image";
import { getCarPlayController } from "./carplayBridge";

/**
 * CarPlay 服务：连接车机后构建模板树。
 *
 * 结构（音频类 App 规范：根模板必须是 CPListTemplate）：
 *   声仓
 *   ├── 最近播放（曲目列表，点选即播）
 *   ├── 我的歌单 → 歌单内曲目
 *   └── 推荐专辑 → 专辑内曲目
 *
 * 播放控制（播放/暂停/上一首/下一首/进度）由 CPNowPlayingTemplate 提供，
 * 按钮事件走 MPRemoteCommandCenter，PlayerContext 里 react-native-track-player
 * 已注册对应 Capabilities，无需额外接线。
 */

/** 单次列表拉取上限（CarPlay 车机对列表项数有限制，取保守值） */
const PAGE_SIZE = 50;

type CarPlayModule = typeof import("react-native-carplay");

let carplayModule: CarPlayModule | null = null;
let initialized = false;

/** 懒加载原生模块：非 iOS 或未安装 pod 时静默降级 */
function loadCarPlay(): CarPlayModule | null {
  if (Platform.OS !== "ios") return null;
  if (carplayModule) return carplayModule;
  try {
    const mod = require("react-native-carplay") as CarPlayModule;
    if (!mod.CarPlay?.bridge) return null;
    carplayModule = mod;
    return mod;
  } catch {
    return null;
  }
}

function trackToListItem(track: Track) {
  return {
    id: String(track.id),
    text: track.name,
    detailText: track.artist || undefined,
    imgUrl: track.cover ? getImageUrl(track.cover, undefined, 300) : null,
    playbackProgress:
      track.duration && track.progress ? track.progress / track.duration : undefined,
  } as const;
}

async function playTracks(tracks: Track[], index: number) {
  const controller = getCarPlayController();
  if (!controller || tracks.length === 0 || !tracks[index]) return;
  await controller.playTrackList(tracks, index);
}

/** 曲目列表模板：点选从该首开始播放整列 */
function buildTrackListTemplate(
  mod: CarPlayModule,
  title: string,
  tracks: Track[],
) {
  return new mod.ListTemplate({
    title,
    sections: [{ items: tracks.map(trackToListItem) as any }],
    async onItemSelect({ index }) {
      await playTracks(tracks, index);
    },
  });
}

/** 最近播放 */
async function openRecentTracks(mod: CarPlayModule) {
  const controller = getCarPlayController();
  const userId = controller?.getUserId();
  let tracks: Track[] = [];
  try {
    if (userId != null) {
      const res = await getTrackHistory(userId, 0, PAGE_SIZE);
      tracks = (res?.code === 200 ? res.data?.list : [])
        .map((item: any) => item?.track ?? item)
        .filter(Boolean);
    } else {
      const res = await getLatestTracks(undefined, false, PAGE_SIZE);
      tracks = res?.code === 200 ? res.data ?? [] : [];
    }
  } catch (e) {
    console.warn("[CarPlay] 加载最近播放失败", e);
  }
  mod.CarPlay.pushTemplate(buildTrackListTemplate(mod, "最近播放", tracks), true);
}

/** 我的歌单 → 歌单内曲目 */
async function openPlaylists(mod: CarPlayModule) {
  let playlists: Playlist[] = [];
  try {
    const res = await getPlaylists();
    playlists = res?.code === 200 ? res.data ?? [] : [];
  } catch (e) {
    console.warn("[CarPlay] 加载歌单失败", e);
  }
  const template = new mod.ListTemplate({
    title: "我的歌单",
    sections: [
      {
        items: playlists.map((p) => ({
          id: String(p.id),
          text: p.name,
          detailText: p._count ? `${p._count.tracks} 首` : undefined,
          showsDisclosureIndicator: true,
        })) as any,
      },
    ],
    async onItemSelect({ index }) {
      const playlist = playlists[index];
      if (!playlist) return;
      let tracks: Track[] = [];
      try {
        const res = await getPlaylistById(playlist.id);
        tracks = res?.code === 200 ? res.data?.tracks ?? [] : [];
      } catch (e) {
        console.warn("[CarPlay] 加载歌单曲目失败", e);
      }
      mod.CarPlay.pushTemplate(
        buildTrackListTemplate(mod, playlist.name, tracks),
        true,
      );
    },
  });
  mod.CarPlay.pushTemplate(template, true);
}

/** 推荐专辑 → 专辑内曲目 */
async function openAlbums(mod: CarPlayModule) {
  let albums: Album[] = [];
  try {
    const res = await getRecommendedAlbums(undefined, false, PAGE_SIZE);
    albums = res?.code === 200 ? res.data ?? [] : [];
  } catch (e) {
    console.warn("[CarPlay] 加载专辑失败", e);
  }
  const template = new mod.ListTemplate({
    title: "推荐专辑",
    sections: [
      {
        items: albums.map((a) => ({
          id: String(a.id),
          text: a.name,
          detailText: a.artist || undefined,
          imgUrl: a.cover ? getImageUrl(a.cover, undefined, 300) : null,
          showsDisclosureIndicator: true,
        })) as any,
      },
    ],
    async onItemSelect({ index }) {
      const album = albums[index];
      if (!album) return;
      let tracks: Track[] = [];
      try {
        const res = await getAlbumTracks(album.id, PAGE_SIZE, 0, "asc");
        tracks = res?.code === 200 ? res.data?.list ?? [] : [];
      } catch (e) {
        console.warn("[CarPlay] 加载专辑曲目失败", e);
      }
      mod.CarPlay.pushTemplate(
        buildTrackListTemplate(mod, album.name, tracks),
        true,
      );
    },
  });
  mod.CarPlay.pushTemplate(template, true);
}

function buildRootTemplate(mod: CarPlayModule) {
  return new mod.ListTemplate({
    title: "声仓",
    sections: [
      {
        items: [
          { text: "最近播放", showsDisclosureIndicator: true },
          { text: "我的歌单", showsDisclosureIndicator: true },
          { text: "推荐专辑", showsDisclosureIndicator: true },
        ] as any,
      },
    ],
    async onItemSelect({ index }) {
      if (index === 0) await openRecentTracks(mod);
      else if (index === 1) await openPlaylists(mod);
      else if (index === 2) await openAlbums(mod);
    },
  });
}

/**
 * 初始化 CarPlay：注册连接/断开回调。
 * 应在 PlayerProvider 挂载后调用（保证播控桥已注册）。
 */
export function initCarPlay() {
  const mod = loadCarPlay();
  if (!mod || initialized) return;
  initialized = true;

  mod.CarPlay.registerOnConnect(() => {
    // 系统"正在播放"模板：按钮走 MPRemoteCommandCenter（RNTP 已注册）
    mod.CarPlay.enableNowPlaying(true);
    mod.CarPlay.setRootTemplate(buildRootTemplate(mod), false);
  });

  mod.CarPlay.registerOnDisconnect(() => {
    // 断开时无需清理模板，原生侧已释放；仅保留控制器注册
  });
}
