import { IMusicAdapter } from "../interface";
import { FnosSearchRecordAdapter } from "../fnos/search-record";
import { UgreenAlbumAdapter } from "./album";
import { UgreenArtistAdapter } from "./artist";
import { UgreenClient, UgreenConfig } from "./client";
import { UgreenCollectionAdapter } from "./collection";
import { UgreenMvAdapter } from "./mv";
import { UgreenPlaylistAdapter } from "./playlist";
import { UgreenSearchAdapter } from "./search";
import { UgreenTrackAdapter } from "./track";
import { UgreenAuthAdapter, UgreenUserAdapter } from "./user-auth";

/**
 * 绿联音乐（UGOS Pro com.ugreen.music）数据源适配器。
 *
 * 用法与飞牛一致：
 * ```ts
 * useUgreenAdapter({ baseUrl: "https://xxx.ug.link", username, password });
 * ```
 *
 * 鉴权说明：
 * - `POST /ugreen/v1/verify/check {username}` 免登录，响应头 `X-Rsa-Token`
 *   是 base64 RSA 公钥（每次轮换），用来加密密码；
 * - `POST /ugreen/v1/verify/login`，密码 = RSA PKCS#1 v1.5 密文（rsa.ts）；
 * - 登录拿到 `data.token`（api_token），之后**所有**接口与媒体地址都以
 *   query `?token=` 携带——媒体地址自带凭据，`<img>`/`<audio>` 直接用，
 *   不需要请求头代理；
 * - 绿联网关 CORS 全开放（`Access-Control-Allow-Origin: *`），浏览器可直连，
 *   不需要飞牛那套 transport 注入 / vite 代理 / Tauri reqwest。
 *
 * 能力差异：没有有声书模式、没有推荐接口（用「最近添加」模拟）、
 * 没有搜索历史接口（端侧实现）、歌词走单曲懒加载。
 */
export class UgreenMusicAdapter implements IMusicAdapter {
  track: UgreenTrackAdapter;
  album: UgreenAlbumAdapter;
  artist: UgreenArtistAdapter;
  playlist: UgreenPlaylistAdapter;
  collection: UgreenCollectionAdapter;
  user: UgreenUserAdapter;
  auth: UgreenAuthAdapter;
  mv: UgreenMvAdapter;
  search: UgreenSearchAdapter;
  searchRecord: FnosSearchRecordAdapter;
  client: UgreenClient;

  constructor(config?: UgreenConfig) {
    this.client = new UgreenClient(config);
    this.track = new UgreenTrackAdapter(this.client);
    this.album = new UgreenAlbumAdapter(this.client, this.track);
    this.artist = new UgreenArtistAdapter(this.client);
    this.playlist = new UgreenPlaylistAdapter(this.client);
    this.collection = new UgreenCollectionAdapter();
    this.user = new UgreenUserAdapter(this.client);
    this.auth = new UgreenAuthAdapter(this.client);
    this.mv = new UgreenMvAdapter();
    // 绿联有真实的 /search/by_type/ai；搜索历史服务端没有，复用端侧实现（按源隔离 bucket）
    this.search = new UgreenSearchAdapter(this.client);
    this.searchRecord = new FnosSearchRecordAdapter("ugreen");
  }
}

export {
  UgreenClient,
  UgreenApiError,
  UGREEN_CODES,
  resolveUgreenServer,
} from "./client";
export type {
  UgreenConfig,
  UgreenErrorKind,
  UgreenRequestOptions,
  UgreenResolvedServer,
  UgreenRawResponse,
} from "./client";
export { rsaEncryptBase64, parseRsaPublicKey } from "./rsa";
export { UGREEN_SORT, UGREEN_ALL } from "./query";
export * from "./types";
