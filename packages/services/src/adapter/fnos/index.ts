import { IMusicAdapter } from "../interface";
import { setFnosAuthKeys } from "./auth";
import { FnosAlbumAdapter } from "./album";
import { FnosArtistAdapter } from "./artist";
import { FnosClient, FnosConfig } from "./client";
import { FnosCollectionAdapter } from "./collection";
import { FnosMvAdapter } from "./mv";
import { FnosPlaylistAdapter } from "./playlist";
import { FnosSearchAdapter } from "./search";
import { FnosSearchRecordAdapter } from "./search-record";
import { FnosTrackAdapter } from "./track";
import { FnosAuthAdapter, FnosUserAdapter } from "./user-auth";

/**
 * 飞牛音乐（fnOS trim.music）数据源适配器。
 *
 * 用法与 Subsonic / Emby 一致：
 * ```ts
 * useFnosAdapter({ baseUrl: "http://192.168.1.10:5666", username, password });
 * ```
 *
 * 鉴权说明（对齐官方客户端 fn-music-tv 的 TrimMusicApi / ConnectionAccess）：
 * - `GET /sys/config` 免登录，用来预检地址、拿 serverName/serverGUID；
 * - 密码登录走 `POST /user/password-login`，body = `{ username, password: sha256(明文), deviceId }`；
 * - 登录后所有请求都以 `Authorization: <userToken>` 发出，**没有 Bearer 前缀**；
 * - 走 FN Connect 中继（`*.fnos.net`）时必须带 `Cookie: mode=relay`；
 * - 封面 `/static/cover` 与音频 `/track/stream` 都要求同一个 Authorization 头，
 *   `<img src>` / `<audio src>` 带不上头，必须走 `fetchMedia()` 或上一层代理。
 *
 * 另外：飞牛网关不返回任何 CORS 响应头，浏览器/WebView 里直接 XHR 会被拦。
 * desktop（Tauri）通过 `setFnosTransport()` 注入 `@tauri-apps/plugin-http` 的 fetch 绕开 CORS。
 */
export class FnosMusicAdapter implements IMusicAdapter {
  track: FnosTrackAdapter;
  album: FnosAlbumAdapter;
  artist: FnosArtistAdapter;
  playlist: FnosPlaylistAdapter;
  collection: FnosCollectionAdapter;
  user: FnosUserAdapter;
  auth: FnosAuthAdapter;
  mv: FnosMvAdapter;
  search: FnosSearchAdapter;
  searchRecord: FnosSearchRecordAdapter;
  client: FnosClient;

  constructor(config?: FnosConfig) {
    this.client = new FnosClient(config);
    this.track = new FnosTrackAdapter(this.client);
    this.album = new FnosAlbumAdapter(this.client, this.track);
    this.artist = new FnosArtistAdapter(this.client);
    this.playlist = new FnosPlaylistAdapter(this.client);
    this.collection = new FnosCollectionAdapter();
    this.user = new FnosUserAdapter(this.client);
    this.auth = new FnosAuthAdapter(this.client);
    this.mv = new FnosMvAdapter();
    // 飞牛有真实的 /search/{track,album,artist,playlist}，历史则是端侧实现（服务端没有）
    this.search = new FnosSearchAdapter(this.client);
    this.searchRecord = new FnosSearchRecordAdapter();
    // 配了 authx 常量就挂上内置签名器（不配则按裸请求发出，1.1.19 的服务端也认）
    if (config?.authxPrefix && config?.clientKey) {
      setFnosAuthKeys({ authxPrefix: config.authxPrefix, clientKey: config.clientKey });
    }
  }
}

export {
  FnosClient,
  FnosApiError,
  FNOS_CODES,
  FNOS_CODE_SESSION_EXPIRED,
  normalizeFnosBaseUrl,
  normalizeFnosDeviceId,
  resolveFnosServer,
  sha256Hex,
  md5Hex,
  setFnosTransport,
  getFnosTransport,
  setFnosMediaProxy,
  getFnosMediaProxy,
} from "./client";
export type {
  FnosConfig,
  FnosErrorKind,
  FnosRequestOptions,
  FnosResolvedServer,
  FnosTransport,
  FnosTransportRequest,
  FnosTransportResponse,
} from "./client";
export {
  setFnosSigner,
  getFnosSigner,
  setFnosAuthKeys,
  getFnosAuthKeys,
  hasFnosAuthKeys,
  createFnosAuthxSigner,
  buildFnosAuthx,
  canonicalFnosQuery,
  hashFnosPayload,
} from "./auth";
export type { FnosAuthKeys, FnosSigner, FnosSignInput, FnosSignature } from "./auth";
export { FnosSearchAdapter } from "./search";
export { FnosSearchRecordAdapter, setSearchRecordStorage } from "./search-record";
export type { SearchRecordStorage } from "./search-record";
export * from "./types";
