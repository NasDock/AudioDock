# 飞牛音乐（fnOS trim.music）HTTP API 速查

> 目标：把 NAS 上的飞牛音乐作为 AudioDock 的**第三种外部音乐源**（对齐 `adapter/emby`、`adapter/subsonic`）。
> 本文的「实测」指 2026-11-10 在 `https://mmdctjj.fnos.net/music/` 的登录态下逐条请求验证过；「待确认」指仅有社区实现或推断，联调时需补验。
> 鉴权部分已按官方开源客户端 [`QiaoKes/fn-music-tv`](https://github.com/QiaoKes/fn-music-tv) 的 `TrimMusicApi` / `ConnectionAccess` 对齐落地（见第 1.1 节）。

---

## 1. 网关与基础约定

| 项 | 值 |
|---|---|
| Base URL（局域网） | `http://<NAS_IP>:5666/music/api/v1` |
| Base URL（FN Connect 远程） | `https://<fnid>.fnos.net/music/api/v1` |
| 协议 | 全部 JSON（媒体资源除外），`GET` 参数放 query，`POST` 放 JSON body |
| 版本头 | `X-Music-API: v1`（登录类接口除外，带上会被网关拒） |
| 会话凭据 | `Cookie: music-token=<userToken>`（`fn-music-player` 实测口径）或请求头 `Authorization: <userToken>`（**无 `Bearer` 前缀**），两者都可；不支持把 token 放 query |
| 响应信封 | `{ "code": 0, "msg": "", "data": { ... } }` |
| 失败判定 | `code != 0` 即失败；`code === 99999` 无效 token（HTTP 401）、`120001` 会话失效、`120002` 账号禁用、`100004` 曲目不可用、`100005` 资源不存在 |
| 时间戳 | `createdAt` / `updatedAt` 等为**秒**（如 `1794195117`） |
| 时长 | `duration` 为**毫秒**（如 `138623`），注意与 AudioDock 的秒制换算 |
| 封面 id | 形如 `track_<32hex>` / `album_<32hex>` / `artist_<32hex>`，前缀决定资源类型 |

实测结论：

- `authx` 逐请求签名是**另一套东西**，和 FN Connect 的 fnId 解析不是一回事：fnId 那条（`https://5ddd.com/api/v1/fn/con`，`FnConnectSigner.authx()`）确实只在解析连接地址时用；但飞牛前端**每个业务请求也会带一个 `authx` 头**，算法见 1.2，常量由前端内置。实测 1.1.19 的服务端**不校验**它（伪造/缺失都返回同样的结果），所以在拿不到两个常量的情况下可以先不签名跑通。
- 飞牛网关**不返回任何 CORS 响应头**，`OPTIONS` 预检直接回 SPA 的 HTML。浏览器 / WebView 里无法直接 XHR，desktop（Tauri）必须把请求交给 Rust 侧发出（`@tauri-apps/plugin-http`）才能绕开。纯 web 部署需要服务端反向代理。

---

## 1.1 鉴权与会话（对齐官方客户端）

### 登录三步

```http
# 1) 预检：免登录，能拿到 serverGUID 就说明地址对、网关活着
GET  <apiBase>/sys/config
→ {"code":0,"data":{"serverGUID":"0fdc7ba6…","serverName":"AudioDock","serverVersion":"1.1.19","mediasrvVersion":"0.8.43","capabilities":{…}}}

# 2) 密码登录：password 必须是小写十六进制的 SHA-256(明文)
POST <apiBase>/user/password-login
Content-Type: application/json
{"username":"alice","password":"<64位hex>","deviceId":"<稳定设备标识>"}
→ {"code":0,"msg":"","data":{"userToken":"…","user":{"guid":"…","name":"alice"}}}

# 3) 之后每个请求都带上（两种都行，官方桌面端用的是 Cookie）
Cookie: music-token=<encodeURIComponent(userToken)>
# 或
Authorization: <userToken>
```

| 细节 | 结论 |
|---|---|
| token 字段名 | `data.userToken`（**不是** `token` / `accessToken`） |
| `Authorization` 格式 | 直接放 token，**不要** `Bearer ` 前缀 |
| `deviceId` | 官方用本地持久化的 UUID；同一账号多设备会各记一条会话 |
| 登录失败 | 实测错误账号返回 `code: 120001`（"unauthorized, please login again"），**和会话失效同码**，登录流程里要单独映射成「账号或密码错误」 |
| 版本头 | 登录接口不要带 `X-Music-API: v1` |

### FN Connect 中继（`*.fnos.net` / `*.5ddd.com`）

远程域名走中继模式，每个请求都要带 `Cookie: mode=relay`（带 token 时再加 `music-token=<token>`），否则网关 **302** 到 FN Connect 登录页：

```http
GET https://mmdctjj.fnos.net/music/api/v1/sys/config
Cookie: mode=relay
→ 200 {"code":0,...}     # 不带 cookie 时是 302
```

> 浏览器禁止脚本设置 `Cookie` 头，这一条同样只有在 Rust 侧发请求时才生效。

---

## 1.2 另一套可用实现：`fn-music-player` 的登录与 authx

开源桌面端 [`kunjingdi/fn-music-player`](https://github.com/kunjingdi/fn-music-player)（Electron + 本地代理）里有完整可跑的登录实现，`server.cjs` 的 `doLogin()` / `makeAuthx()` 是本文档这一节的事实来源。

### 登录请求（逐字节可照抄）

```js
const pathname = "/music/api/v1/user/password-login";
const body = JSON.stringify({
  username,
  password: SHA-256hex(明文密码),        // 小写 hex
  deviceId,                            // 32 位小写 hex，首次随机生成后持久化
});

POST <origin> + pathname
Accept: application/json
Accept-Language: zh-CN
Content-Type: application/json
User-Agent: fnmusic-desktop-player/1.0
authx: nonce=<6位随机数>&timestamp=<毫秒>&sign=<md5>

→ {"code":0,"data":{"userToken":"…","user":{…}}}
```

- **成功判据**：`code === 0 && data.userToken`。
- **失败判据**：`120001` = 账号或密码错误（同一码也用于会话失效，按流程区分）；`99999` = 无效 token。
- 登录成功后，后续请求统一带 `Cookie: music-token=<encodeURIComponent(userToken)>`；**没有** `Authorization`、**也没有** `X-Music-API` 头。媒体接口（`/static/cover`、`/track/stream`）走同一套头，并透传 `Range`。

### authx 签名（MD5，不是 HMAC）

```js
const nonce = String(Math.floor(Math.random() * 9e5) + 1e5);   // 6 位
const ts = String(Date.now());
const payloadHash = isGet
  ? hashPayload(canonicalQuery(query))     // 见下
  : md5(bodyStr ?? "");
const sign = md5([AUTHX_PREFIX, pathname, nonce, ts, payloadHash, CLIENT_KEY].join("_"));
const authx = `nonce=${nonce}&timestamp=${ts}&sign=${sign}`;

// query 规范化：key 排序 → URLSearchParams → '+' 换成 '%20'
function canonicalQuery(obj) {
  const u = new URLSearchParams();
  for (const k of Object.keys(obj || {}).sort()) {
    if (obj[k] != null) u.append(k, String(obj[k]));
  }
  return u.toString().replace(/\+/g, "%20");
}
// 与前端一致的“先补孤立 %，再 decode，失败退回原文”
function hashPayload(str) {
  try { return md5(decodeURIComponent(str.replace(/%(?![0-9A-Fa-f]{2})/g, "%25"))); }
  catch { return md5(str); }
}
```

要点：

- `AUTHX_PREFIX` 和 `CLIENT_KEY` 是飞牛前端内置的两个常量，**仓库里不提供**（只给了 `config.local.example.json` 占位）。缺了它们的表现是「能打开、登录失败」。
- `pathname` 必须是**含 `/music/api/v1` 前缀**的完整路径。
- GET 的 payload 是「规范化后再 URL-decode」的 query；POST 是 **body 原文**。
- 实测 1.1.19 这个版本伪造/缺失 authx 都能拿到同样的 `120001`（说明它不校验），但换版本或媒体接口时不要赌。

### 错误与重登

```js
if (json.code === 99999) {          // token 失效
  reloginPromise ||= relogin();     // 并发请求共享同一次重登
  await reloginPromise;
  return raw(path, opts);           // 重试一次
}
```

### 封面 id 的坑

`/static/cover` 只认 `album_<hex>` / `track_<hex>` / `artist_<hex>` 形式的 id；有些接口（歌单详情）会塞裸的 32 位 hex（其实是曲目 GUID），传进去**返回 400**。规则：`/^[a-z]+_/i` 才用，否则丢掉或换用专辑封面。歌单封面取「第一首有封面的歌」。

---

## 2. 分页与排序（统一契约）

```
GET <path>?page=1&size=50&sort=<field>,<asc|desc>
```

| 参数 | 说明 |
|---|---|
| `page` | 页码，**1 起**（不是 0） |
| `size` | 每页条数，默认 50；`size=-1` = 返回全部（列表类接口通用） |
| `sort` | `字段,方向` 字符串，如 `createdAt,desc`；**响应会原样回显 `data.sort`**，可用它自检参数是否被接受 |

分页响应统一为：

```json
{ "code": 0, "msg": "", "data": { "list": [], "total": 12, "sort": "createdAt,desc" } }
```

- **没有 `hasMore`**，是否继续翻页只能靠 `total` 自己算。
- 各接口默认排序不同（实测）：`track/list` → `createdAt,desc`；`track/album-detail/list` → `trackNo,asc`；`favorite-track/list` → `favoriteAt,desc`；`artist/list` → `trackCount,asc`。
- 搜索类接口有两个坑（社区实测）：分页越界会**回钳到第 1 页**而不是返回空；部分版本会**忽略 `size` 全量返回**。客户端要按 `total` 做本地切片兜底。

---

## 3. 数据模型

### 3.1 TrackVO（曲目）— 实测

```json
{
  "guid": "8adb708c67534598c45d0d24560a4e0",
  "title": "愿一天有人这样唱给我",
  "coverId": "track_281695ea98564d19b83b3abdfe0b8448",
  "year": 2019,
  "discNo": null,
  "trackNo": 2,
  "isCue": false,
  "duration": 138623,
  "createdAt": 1794195117,
  "updatedAt": 1794195117,
  "album": {
    "guid": "2881e250cb6445bfbb31e9bd553e5c1e",
    "name": "什么都不是",
    "coverId": "track_281695ea98564d19b83b3abdfe0b8448",
    "releaseDate": "2019",
    "barcode": null,
    "createdAt": 1794195117,
    "updatedAt": 1794195117
  },
  "artists": [{ "guid": "c5e5a0b0e8264f829c0ab99848cbf...", "name": "花粥" }],
  "genres": [],
  "audioSpec": {
    "bitDepth": 32, "sampleRate": 44100, "channel": 2,
    "bitrate": 64000, "codec": "mp3", "container": "",
    "duration": 138623, "format": "mp3",
    "path": "/vol1/1000/music/花粥/xxx.mp3"
  },
  "size": 1147868,
  "isFavorite": false
}
```

要点：

- `album.coverId` **可能复用曲目封面**（`track_` 前缀），不要假设一定以 `album_` 开头。
- `audioSpec.path` 是 NAS 绝对路径，**不要下发给客户端**。
- `isCue: true` 表示 CUE 整轨拆出来的虚拟曲目，`guid` 是独立的，可直接播放。
- 搜索接口返回的条目额外带 `score`（浮点相关度）。

### 3.2 AlbumVO — 实测

```json
{ "guid": "2881e250cb6445bfbb31e9bd553e5c1e", "name": "什么都不是",
  "coverId": "track_281695ea98564d19b83b3abdfe0b8448",
  "releaseDate": "2019", "barcode": null,
  "createdAt": 1794195117, "updatedAt": 1794195117,
  "artists": [{ "guid": "...", "name": "花粥" }] }
```

`album/detail` 会额外带 `trackCount`。

### 3.3 ArtistVO — 实测

```json
{ "guid": "22271b2601674b5da00ced34adda7bef", "name": "花粥",
  "coverId": "artist_1f76e8fd748a4a509633c5628a479378",
  "createdAt": 1794195117, "updatedAt": 1794195117,
  "trackCount": 4, "albumCount": 1 }
```

### 3.4 UserVO — 实测

```json
{ "guid": "3ad2df969d4951f854dc4fbd72e79e", "name": "AudioDock",
  "role": "admin", "lastAccessedAt": 1794309391,
  "createdAt": 1794194828, "updatedAt": 1794309399 }
```

`guid` 就是「当前用户 id」，`isFavorite` 的归属、收藏/历史的读写都基于它。

---

## 4. 接口清单

### 4.1 初始化 / 用户

| 方法 | 路径 | 参数 | 说明 | 状态 |
|---|---|---|---|---|
| GET | `/initialization/state` | — | 探活 + 是否已初始化；返回 `{"initialized":true}` | 实测 |
| GET | `/user/me` | — | 当前用户 | 实测 |
| POST | `/user/password-login` | `{username, password}`，password = `SHA-256(明文)` | 登录，返回 token | 文档 |
| POST | `/user/auth-login` | — | 免密/临时 token 登录 | 文档 |
| POST | `/user/logout` | — | 登出 | 文档 |

### 4.2 曲库

| 方法 | 路径 | 参数 | 说明 | 状态 |
|---|---|---|---|---|
| GET | `/track/list` | `page,size,sort` | 全部曲目分页 | 实测 |
| GET | `/track/album-detail/list` | `albumGUID,page,size,sort` | 专辑内曲目，默认 `trackNo,asc` | 实测 |
| GET | `/track/artist-detail/list` | `artistGUID,page,size,sort` | 歌手内曲目 | 文档 |
| GET | `/track/playlist-detail/list` | `playlistGUID,page,size,sort` | 歌单内曲目 | 文档 |
| GET | `/track/metadata` | `guid` | 单曲元数据 | 待确认 |
| GET | `/track/audio-info` | `guid` | 单曲音频规格 | 待确认 |
| GET | `/lyric/list` | `trackGUID` | 歌词，见下方 4.2.1 | 实测 |
| GET | `/lyric/list/{subpath}` | — | 同上（路径式） | 待确认 |

> 参数大小写：官方用 **`albumGUID` / `playlistGUID`**（`xxxGuid` 为兼容别名），`guid` 单数用于详情类接口。

#### 4.2.1 歌词（实测）

```
GET /music/api/v1/lyric/list?trackGUID=8adb708c675345998c45d0d24560a4e0
```

```json
{
  "code": 0,
  "msg": "",
  "data": {
    "list": [
      {
        "guid": "a08acc1c8bb1456fb08bb562d932f815",
        "source": 1,
        "content": "[00:00.00]作词 : 无\n[00:15.21]总想跟着你\n...",
        "createdAt": 1794195117,
        "updatedAt": 1794195117,
        "isLRC": true,
        "offset": 0
      }
    ],
    "preferred": "a08acc1c8bb1456fb08bb562d932f815"
  }
}
```

- 参数只认 **`trackGUID`**（曲目 `guid`）；`guid` 是历史兼容写法，实测已不再生效。
- `list` 可能有多份（不同来源/翻译），`preferred` 指向官方选中的那份；`content` 为 LRC 文本，`isLRC: true`。
- 无歌词时 `list` 为空数组，`preferred` 为空串。
- **歌词不在 `TrackVO` 里**：曲目列表/详情都不带歌词，必须单曲单独请求，所以客户端要在播放时懒加载。

### 4.3 专辑 / 歌手

| 方法 | 路径 | 参数 | 说明 | 状态 |
|---|---|---|---|---|
| GET | `/album/list` | `page,size,sort` | 专辑分页 | 实测 |
| GET | `/album/detail` | `guid` | 专辑详情（含 `trackCount`） | 实测 |
| GET | `/artist/list` | `page,size,sort` | 歌手分页（含 `trackCount`/`albumCount`） | 实测 |
| GET | `/artist/list-all` | — | 全量歌手，不分页（适合做筛选器） | 文档 |
| GET | `/artist/detail` | `guid` | 歌手详情 | 文档 |

### 4.4 歌单

| 方法 | 路径 | 参数 / Body | 说明 | 状态 |
|---|---|---|---|---|
| GET | `/playlist/list` | `page,size` | 歌单分页，`{list,total}` | 实测（空库） |
| GET | `/playlist/detail` | `guid` | 歌单详情（含 `trackCount`） | 文档 |
| GET | `/playlist/batch-detail` | `guids=a,b,c` | 批量详情，逗号分隔 | 文档 |
| GET | `/track/playlist-detail/list` | `playlistGUID,...` | 歌单内曲目 | 文档 |
| POST | `/playlist/add-track` | `{ "guid": "<歌单>", "trackGUIDs": ["..."] }` | 批量加歌（官方契约是批量） | 文档 |
| POST | `/playlist/remove-track` | `{ "guid": "<歌单>", "trackGUIDs": ["..."] }` | 批量移除 | 文档 |
| POST | `/playlist/delete` | `{ "guid": "..." }` | 删歌单 | 文档 |
| POST | `/playlist/create` | `{ "name": "..." }` | 新建歌单 | 已确认 |
| POST | `/playlist/update` | `{ "guid": "...", "name": "..." }` | 改名 | 已确认 |

### 4.5 搜索

| 方法 | 路径 | 参数 | 说明 | 状态 |
|---|---|---|---|---|
| GET | `/search/track` | `q,page,size` | 曲目搜索，条目带 `score` | 实测 |
| GET | `/search/album` | `q,page,size` | 专辑搜索，条目带 `trackCount`/`score` | 实测 |
| GET | `/search/artist` | `q,page,size` | 歌手搜索，条目带 `trackCount`/`albumCount` | 实测 |
| GET | `/search/playlist` | `q,page,size` | 歌单搜索（空库返回 `{list:[],total:0}`） | 实测 |
| GET | `/search/suggest` | `q` | 搜索联想，返回 `{track:{total,items},album?,artist?}` | 实测 |
| POST | `/search/index/rebuild` | — | 重建搜索索引（管理用） | 前端确认 |

> 关键词参数官方用 **`q`**（`keyword` / `query` 为兼容别名，非官方接口不一定认）。
>
> 官方前端点一次搜索会**并发**打 track / album / artist / playlist 四个接口（实测请求头与参数一致，`size=24`），
> 请求里同时带 `authx` 与 `Cookie: mode=relay; music-token=…`；1.1.19 服务端不校验 `authx`。
>
> **飞牛没有搜索历史接口**：前端历史存在浏览器本地，服务端只有上面的搜索接口。
> AudioDock 侧由 `adapter/fnos/search-record.ts` 用端侧存储实现（按数据源 origin 隔离，
> 热搜榜由本地累计次数统计），签名与官方服务端 `/search-record/*` 保持一致。

### 4.6 收藏 / 历史

| 方法 | 路径 | 参数 / Body | 说明 | 状态 |
|---|---|---|---|---|
| GET | `/favorite-track/list` | `page,size` | 收藏曲目，默认 `sort=favoriteAt,desc` | 实测（空库） |
| POST | `/favorite-track/create` | `{ "trackGUID": "..." }` | 加收藏 | 文档 |
| POST | `/favorite-track/delete` | `{ "trackGUID": "..." }` | 取消收藏 | 文档 |
| GET | `/play-history/list` | `page,size` | 播放历史（`list` 直接是 TrackVO 数组） | 实测 |
| POST | `/play-history/delete` | `{ "trackGUIDs": ["..."] }` | 删除历史（单条/批量同一接口） | 文档 |
| POST | `/event/report` | `{ "events": [ { "eventType": "track_play", "payload": { "trackGUID": "..." } } ] }` | 上报播放事件（写历史/统计） | 文档 |

### 4.7 媒体资源（**必须带 `Authorization` 头**）

| 方法 | 路径 | 参数 | 说明 | 状态 |
|---|---|---|---|---|
| GET | `/static/cover` | `coverId`、可选 `size` | 封面图（jpg/png/webp）；无 token → **401** `{"code":99999}` | 实测 |
| GET | `/track/stream` | `guid` | 音频流，支持 `Range`（可 seek）；无 token → **401** | 实测 |
| GET | `/track/hls/{guid}/preset.m3u8` | — | HLS 播放列表 | 待确认 |
| GET | `/track/hls/{guid}/{filename}` | — | HLS 分片 | 待确认 |
| POST | `/track/transcode` | `{trackGUID, quality}` | 转码播放（切码率） | 待确认 |
| POST | `/track/transcode/heartbeat` | — | 转码保活 | 待确认 |
| POST | `/track/transcode/quit` | — | 结束转码 | 待确认 |

> ⚠️ 媒体接口只认 `Authorization` 请求头：实测 `?token=` / `?userToken=` / `?access_token=` / `Cookie: music-token=` 全部返回 401。
> 浏览器 `<img src>` / `<audio src>` 无法附加请求头，所以封面必须走 `fetchMediaObjectUrl()` 拉 Blob 再转 objectURL；
> 音频要么走同样的 blob 路径，要么在服务端做一次带头的反向代理。

### 4.8 其他

| 方法 | 路径 | 说明 | 状态 |
|---|---|---|---|
| POST | `/shared-library/create` `/edit` `/delete` `/reconnect` `/scan` | 共享曲库（多用户/挂载）管理 | 待确认 |
| GET | `/folder-view/list` | 按 NAS 目录浏览（`path,keyword,sort,asc,page,size`） | 待确认 |
| GET | `/genre/list` | 风格列表（前端有「风格」入口，路径未核实） | 待确认 |
| POST | `/download/track/transcode/prepare` `/status` `/file` `/delete` | 离线下载/转码导出 | 待确认 |

---

## 5. 典型请求示例

```http
GET /music/api/v1/track/list?page=1&size=50&sort=createdAt,desc
Authorization: <userToken>
X-Music-API: v1

→ {"code":0,"msg":"","data":{"list":[...],"total":5,"sort":"createdAt,desc"}}
```

```http
GET /music/api/v1/search/track?q=花粥&page=1&size=20
→ {"code":0,"msg":"","data":{"list":[{...track,"score":0.00189}],"total":2,"sort":""}}
```

```http
POST /music/api/v1/favorite-track/create
{"trackGUID":"8adb708c67534598c45d0d24560a4e0"}
→ {"code":0,"msg":"","data":null}
```

---

## 6. 接入 AudioDock 的方案

### 6.1 落点（已实现）

`packages/services/src/adapter/` 下的 `fnos/` 已经落地，结构与 emby / subsonic 对齐：

```
packages/services/src/adapter/fnos/
├── types.ts      # 官方 VO：FnosTrack / FnosAlbum / FnosArtist / FnosPage<T> / 信封
├── auth.ts       # setFnosSigner() 签名注入点（authx 由外部模块提供）
├── client.ts     # baseUrl 归一化、信封解包、Authorization、媒体 URL 签名、SHA-256
├── query.ts      # skip→page 换算、sort 映射、歌手/专辑名→guid 反查
├── mapper.ts     # FnosXxx → Track / Album / Artist / Playlist / User
├── track.ts      # track/list、album-detail、artist-detail、favorite-track、lyric
├── album.ts      # album/list、album/detail、专辑内曲目（复用 track.getAlbumTracks）
├── artist.ts     # artist/list、artist/detail
├── playlist.ts   # playlist/list、detail、add-track、remove-track
├── user-auth.ts  # password-login、user/me、play-history、event/report
├── collection.ts # 有声书收藏位（飞牛无此能力，空实现）
├── mv.ts         # MV（飞牛无此能力，空实现）
└── index.ts      # 组装成 FnosMusicAdapter
```

接线点：

| 文件 | 改动 |
|---|---|
| `adapter/manager.ts` | `useFnosAdapter(config?)`，并透出 `setFnosSigner` / `normalizeFnosBaseUrl` / `FnosApiError` |
| `src/index.ts` | `SOURCEMAP.Feiniu = "fnos"`、`SOURCETIPSMAP.Feiniu` |
| `apps/desktop/src/https/index.ts` | `initAdapter()` 里 `mappedType === "fnos"` → `useFnosAdapter()` |
| `apps/desktop/src/components/LoginModal` | 数据源多一个「飞牛」，登录走 `adapter.auth.login()` |
| `apps/desktop/src/components/Header` | 服务器切换菜单支持 fnos 分支 |

### 6.2 字段映射

| 官方 | AudioDock | 备注 |
|---|---|---|
| `track.guid` | `Track.id` | 直接用 32hex 字符串 id |
| `track.title` | `Track.name` | |
| `track.artists[0].name` | `Track.artist` | 多歌手用 ` / ` 拼接 |
| `track.artists[0].guid` | `Track.artistId` | |
| `track.album.name` / `.guid` | `Track.album` / `Track.albumId` | |
| `track.coverId` | `Track.cover` | 转成 `/static/cover?coverId=` 绝对地址 |
| `track.duration`(ms) | `Track.duration`(s) | **除 1000 并取整** |
| `track.trackNo` | `Track.index` | |
| `track.isFavorite` | `Track.likedByUsers` | 塞当前 `/user/me`.guid |
| `album.releaseDate` | `Album.year` | 官方是字符串 `"2019"` |
| `artist.trackCount/albumCount` | `Artist.*` | 可用于列表页展示 |

### 6.3 分页换算

```ts
// AudioDock 侧用 skip + pageSize，官方用 page(1起) + size
const page = Math.floor(skip / pageSize) + 1;
const size = pageSize;
// 返回 total 后自己算 hasMore = skip + list.length < total
```

### 6.4 请求链路（两端各一套）

飞牛网关没有 CORS 头，中继地址还强制 `Cookie: mode=relay`，所以两个运行环境各走一条通道：

| 运行环境 | 传输方式 | 位置 |
|---|---|---|
| web（`vite dev`） | 同源 `/__fnos`，由 dev server 代转并补 Cookie | `apps/desktop/vite-plugin-fnos-proxy.ts` |
| 桌面端（Tauri） | `fnos_request` 命令，Rust 侧用 reqwest 发请求 | `apps/desktop/src-tauri/src/fnos_http.rs` |
| **移动端（RN）** | **默认 axios 传输层直连**（原生没有 CORS，不需要代理） | `packages/services/src/adapter/fnos/client.ts` |
| web 生产构建 | 未实现，需要服务端反向代理 | — |

前端通过 `setFnosTransport()` 注入对应的传输层（`apps/desktop/src/services/fnosTransport.ts`），
`FnosClient` 只负责拼 URL / 拼请求头 / 解信封，不关心请求从哪条通道出去。

> **移动端不要注入传输层**：`FnosClient` 的默认传输层就是 axios，RN 端原生 XHR 不受同源策略约束，
> 直连即可。注入 `setFnosTransport` 反而多余（而且 RN 没有 `fetch` 的跨域限制这一说）。

### 6.4.1 移动端（RN）特有的三个坑

**① 全局 `URL` 是存根，不能赋值**

React Native 用 `polyfillGlobal('URL', …)` 把全局 `URL` 换成 `Libraries/Blob/URL`，
那份实现**只有 getter，没有 `protocol` / `port` 的 setter**。ES module 是严格模式，
`url.protocol = "https:"` 会直接抛 `TypeError`。

所以 `resolveFnosServer()` 已改成**纯字符串解析**（不再 `new URL()`），
`apps/mobile/src/constants/sources.ts` 的 `normalizeFnosAddress()` 直接复用它，
不要在端侧再写一份 URL 解析。

**② `URLSearchParams` 的编码差异**

RN 的 `URLSearchParams` polyfill 用 `encodeURIComponent`，
浏览器/WHATWG 的 urlencoded 序列化器对 `! ' ( )` 的转义规则不同。
`canonicalFnosQuery()` 算的是 authx 签名，而实测 1.1.19 服务端**不校验 authx**，
所以这个差异不影响功能（只有服务端开始校验时才会暴露）。

**③ `expo-image` 的 `prefetch` 不支持自定义 header**

`expo-image` 的 `prefetch(url)` 没有 headers 参数，
带鉴权的封面预取必然 401 —— 飞牛源要跳过预取（`app/player.tsx` 里按 `hasMediaHeaders` 判断）。

### 6.5 媒体链路（封面 / 音频）

媒体接口只认 `Cookie` / `Authorization`，而 `<img src>` / `<audio src>` 加不了请求头：

- **web（已跑通）**：`setFnosMediaProxy("<origin>/__fnos")` 后，`getCoverUrl()` / `getStreamUrl()`
  直接返回代理地址，`<img>` / `<audio>` 可以直接用。
  - 会话 token 由 dev server 按 origin 记住（API 请求带的 token），**不写进 URL** ——
    否则整条地址会被应用缓存进 localStorage，重新登录后 token 变了就全 401。
  - `Range` 原样透传，实测封面 `200 image/jpeg`、音频 `206 audio/mpeg`，可以拖进度。
- **桌面端（已跑通，2026-11-10）**：复用本地回环媒体服务器，`setFnosMediaProxy("<mediaOrigin>/fnos")`。
  - 路由在 `src-tauri/src/fnos_media.rs`：`GET /fnos/{*rel}?…&__b=<上游 origin>`，从 query 摘掉
    `__b` 拼上游地址，补 `Cookie`、透传 `Range`、响应体流式回灌。
  - 会话 Cookie 由前端在每次业务请求时通过 `fnos_set_media_session` 同步到 Rust
    （按 origin 存、按 token 去重、**不写进 URL**），首个媒体地址生成前一定已就绪
    （`tauriTransport` 先 await 代理初始化，再 await 会话同步，最后才发业务请求）。
  - 实测：封面 `200 image/jpeg`（640×640）、音频 `206 audio/mpeg` + `content-range`。
  - 为什么不用 `fnos://` 自定义协议：AVPlayer 无法从自定义协议流式播放，
    而 `http://127.0.0.1` 是它原生支持的传输方式（`media_server.rs` 就是为此存在）。
  - 媒体服务端口每次启动随机 → 前端初始化代理后会清一次 `soundx_cache_*`，
    否则 5 分钟内会用到上一进程拼好的旧端口地址。
- **移动端（已跑通）**：原生组件**都能带请求头**，不用代理：
  - `RN <Image source={{uri, headers}}>` —— iOS 走 `RCTConvert` → `allHTTPHeaderFields`，
    Android 走 `ReactNetworkImageRequest.fromBuilderWithHeaders`；
  - `expo-image` 的 `source.headers`；
  - `expo-file-system` 的 `downloadAsync(url, path, {headers})`（缓存封面/音频）；
  - `react-native-track-player` 的 `Track.headers`（**只有 `url` 支持，`artwork` 不支持**）。
  - 统一从 `apps/mobile/src/utils/mediaAuth.ts` 的 `getMediaHeaders()` 取头，
    封面统一走 `getImageSource()`（返回 `{uri, headers}`）而不是裸 URL。

### 6.6 播放地址的一个坑

`buildTrackPlaybackUrl()` 原本无脑拼 `{AudioDock 服务端}/track/stream/{id}`，
外部数据源的 id 它不认识，必然 404。已加分支：第三方源（Subsonic / Emby / 飞牛）
直接返回 `track.path`，且**不能再追加 `?quality=`**（这些地址自带 query）。

### 6.7 已知阻塞

| 阻塞 | 影响 | 现状 |
|---|---|---|
| 网关无 CORS 头 | 浏览器/webview 直连被拦 | **已解决**：web 走 `/__fnos` 代理、桌面走 `fnos_request` |
| `Cookie: mode=relay` 是禁止头 | 浏览器直连 `*.fnos.net` 一定 302 | **已解决**：由代理/ Rust 侧补，浏览器侧只发自定义头 |
| `plugin-http` 默认 scope 为空 + 过滤 Cookie | 请求在 Rust 侧被拒或在 JS 层被丢，devtools 里看不到任何请求 | **已绕开**：改用自定义 `fnos_request` 命令 |
| 非安全上下文没有 `crypto.subtle` | 密码哈希抛错 → 预检成功但登录 POST 不发 | 已解决：`hash.ts` 内置纯 JS 兜底 |
| 桌面端媒体无鉴权通道 | 封面/音频 401 | **已解决**：本地 `/fnos` 转发路由（`fnos_media.rs`） |

#### http 插件的 scope 写法（踩坑记录）

URLPattern 里端口是独立分量：`http://*` **不匹配** `http://192.168.1.10:5666/...`，有端口就必须显式写 `:*`。
实测矩阵（urlpattern 0.3）：

| pattern | 无端口 URL | 带端口 URL |
|---|---|---|
| `http://*` | ✅ | ❌ |
| `http://*:*` | ✅ | ✅ |
| `*://*` | ✅（http/https） | ❌ |
| `*://*:*` | ✅ | ✅ |

所以四条都要写：

```json
{
  "identifier": "http:default",
  "allow": [
    { "url": "http://*" },
    { "url": "http://*:*" },
    { "url": "https://*" },
    { "url": "https://*:*" }
  ]
}
```

#### 登录时的请求顺序（排查用）

```
① GET  /music/api/v1/sys/config            ← 免登录预检，不是登录接口
② POST /music/api/v1/user/password-login   ← 真正的登录，body {username, SHA-256(password), deviceId}
```

只看到 ① 没有 ②，说明链路在预检之后断了（transport 被拒 / SHA-256 抛错 / CORS 预检失败），
不是「接口选错」。控制台搜 `[Fnos] →` / `[Fnos] ←` 能看到每条请求的去向。


### 6.8 需要注意的差异

1. **id 是 32 位 hex 字符串**，不是数字 —— `ITrackAdapter` 里所有 `number | string` 的签名没问题，但下游若做 `parseInt` 会 NaN。
2. **无 `hasMore`**，`ILoadMoreData` 的 `hasMore` 要自己用 `total` 算。
3. **搜索分页非标**（越界回钳、忽略 size），必须在适配层做本地切片 + 去重。
4. **CUE 整轨**：`isCue:true` 的曲目共用同一个物理文件，播放时长/封面可能取整轨值，列表展示要按 `trackNo` 排序而不是更新时间。
5. **收藏/历史是「按用户」的**，切换 AudioDock 账号时要重新拉 `/user/me` 并把 `isFavorite` 重算，不能跨用户缓存。
6. **没有 MV、没有有声书分类**：`mv` / `collection` 直接返回空实现，`type=AUDIOBOOK` 时回退 MUSIC 或空列表。

### 6.9 移动端（apps/mobile）接入清单

移动端是 Expo / RN 原生应用，和 desktop 的 webview 差别很大 —— **没有 CORS，所以不用代理，
但「所有媒体接口都要带 `Authorization` 头」这件事反而更致命**（原生组件默认不带头）。

落点：

| 文件 | 改动 |
|---|---|
| `packages/services/src/index.ts` | `SOURCEMAP.Feiniu = "fnos"`（公共常量，desktop / mobile 共用；mini 有自己的本地清单，不受影响） |
| `apps/mobile/src/constants/sources.ts` | 数据源展示名 / logo / 类型映射 / `normalizeFnosAddress()`（复用 `resolveFnosServer`） |
| `apps/mobile/app/login.tsx` · `login-form.tsx` · `source-manage.tsx` | 数据源列表多「飞牛」；隐藏「去注册」与扫码登录 |
| `apps/mobile/src/context/AuthContext.tsx` | 启动/切源时 `activateFnosAdapter({baseUrl, username, password, token})` |
| `apps/mobile/src/utils/networkUtils.ts` | 连通性探测走 `/music/api/v1/sys/config`，并校验响应体 `code === 0` |
| `apps/mobile/src/utils/playMode.tsx` | 飞牛只有音乐 → 强制 MUSIC 模式 |
| `apps/mobile/src/utils/mediaAuth.ts` | `getMediaHeaders()`：飞牛源返回 `{Authorization: <userToken>}`，其它源返回 `{}` |
| `apps/mobile/src/utils/image.ts` | `getImageSource()`：返回 `{uri, headers}`，替换全部裸 `getImageUrl` 调用点 |
| `apps/mobile/src/context/PlayerContext.tsx` | RNTP 队列条目带 `headers`；通知栏封面落盘后写回；飞牛歌词懒加载（切歌时按需拉 `/lyric/list`） |
| `apps/mobile/src/services/cache.ts` · `trackResolver.ts` | 封面/音频缓存下载带 `headers` |
| `apps/mobile/src/utils/dominantColorLocal.ts` | 播放页主题色/磨砂图的封面下载带 `headers`（否则飞牛封面 401 → 没主题色） |
| `apps/mobile/src/services/carplay.ts` | CarPlay 列表封面先落盘再给本地路径 |
| `apps/mobile/src/native/WidgetBridge.ts` | 桌面小组件封面缓存带 `headers` |
| `apps/mobile/src/services/searchRecord.ts` | 飞牛没有搜索历史接口 → 用 AsyncStorage 顶替（`setSearchRecordStorage`） |

#### 连通性探测为什么要校验 `code === 0`

`/sys/config` 免登录，但**中继未放行时会 302 到 SPA 登录页**，
`fetch` 默认跟随重定向 → 拿到 `200 + HTML`，只看状态码会误判成「连上了」。
所以要再解析一次响应体，确认是飞牛的 JSON 信封且 `code === 0`。

#### 中继（`*.fnos.net`）必须带 `Cookie: mode=relay`

业务请求由 `FnosClient.buildHeaders()` 自动补 `Cookie: mode=relay`，
但**端侧自己发的裸请求**（如上面的连通性探测、`<Image>` 拉封面）不会自动带上，
不带就 302 到 FN Connect 登录页 → 表现为「连不上 / 封面裂 / 播放失败」。

RN 侧手动设 `Cookie` 头有两个坑：

| 坑 | 现象 | 处理 |
|---|---|---|
| Android：OkHttp `BridgeInterceptor` 在 cookie jar 非空时会用 jar 的 cookie **覆盖**请求的 Cookie 头 | 手动设的 `mode=relay` 被冲掉 → 又 302 | `fetch(..., {credentials: 'omit'})` / axios `withCredentials: false` → RN 用 `CookieJar.NO_COOKIES`，手动设的头原样发出 |
| iOS：`RCTHTTPRequestHandler` 的重定向回调会把 `allHTTPHeaderFields` 整个替换成 cookie storage 里的 cookie | 发生 302 时 `Authorization` 也一起丢 | 正常请求不该发生 302（带上 `mode=relay` 就不会），发生即代表中继没放行 |

所以移动端的两处都要显式关 credentials：

- `apps/mobile/src/utils/networkUtils.ts`：`fetch(..., { credentials: "omit" })`；
- `packages/services/src/adapter/fnos/client.ts` 的默认 axios 传输层：`withCredentials: false`。

媒体头（`getMediaHeaders()`）在 `Authorization` 之外，中继地址还要补
`Cookie: mode=relay; music-token=<token>` —— 少了这一条，中继上的封面和音频全部拉不下来。

#### 原生播控（通知栏 / 锁屏）的封面

RNTP 的 `Track.artwork` **不支持自定义 header**，系统拉图时只会裸拉 URL → 飞牛必然 401。
处理方式：

1. 起播瞬间先查本地封面缓存，命中就直接把 `file://` 路径塞进 `artwork`；
2. 没命中就后台把封面落盘（带 `Authorization`），再用
   `TrackPlayer.updateMetadataForTrack(activeIndex, {artwork})` 写回去。

写回时用 `getActiveTrackIndex()` 而不是记入队时的下标 —— 起播后旧曲目会被移除，
队列下标会整体前移，按旧下标更新会改错歌的封面。

CarPlay 同理：车机自己拉图（`imgUrl` 只能是 URL 或本地文件路径），
所以列表构建前先把封面落盘，给车机本地路径。

#### 播放页主题色：本地解码也必须带 `headers`（2026-11-11）

移动端播放页的主题色 / 磨砂底图是**纯本地**算的（`apps/mobile/src/utils/dominantColorLocal.ts`）：
下载封面 → 纯 JS 解码（`jpeg-js` / `upng-js`）→ 32×32 采样取色。

这条链路自己发 HTTP 请求，**不会**经过 `FnosClient`，所以 `FnosClient.buildHeaders()`
自动补的 `Authorization` / `Cookie: mode=relay` 全都没有 → 飞牛 `/static/cover` 401 →
「封面能显示（走 `getImageSource()` 的组件带头）但播放页没有主题色」。

修法：下载时显式带 `getMediaHeaders()`（非飞牛源返回 `{}`，不影响其它数据源）。
顺带加了一条 content-type 校验：中继缺 `mode=relay` 时网关 302 到登录页，
跟随后拿到的是 `200 + HTML`，按 `image/` 前缀提前判掉，别把登录页当图片解码。

#### 歌词：列表接口不带 lyrics，要按曲目单独拉

飞牛的曲目列表（`/track/list` 等）**不返回 `lyrics`**，
歌词只有单曲接口 `GET /lyric/list?trackGUID=<guid>` 能取到（返回 `{list:[{content}]}`，LRC 文本）。

mobile 端原先没有这条链路 → 飞牛歌曲播放页永远是「无歌词」。
处理方式（与 desktop 的 `components/Player/index.tsx` 一致）：

- `PlayerContext` 里切歌时按需调 `getTrackLyrics(track.id)`；
- 拿到后**并回当前曲目**（`setCurrentTrack({...track, lyrics})`），
  这样播放页歌词面板、车机歌词（CarWith / Android Auto / CarPlay）、
  歌词字号预览三处共用同一份，不用分别改；
- 带一个 `Map<trackId, lyrics>` 内存缓存，切回同一首不再重复请求；
- 其它数据源的 `Track` 里已内建 `lyrics`，命中后直接跳过请求。

---

## 7. 待确认清单（联调时优先补）

| # | 项 | 影响 |
|---|---|---|
| 1 | ~~`authx` 签名算法~~ | **已解决**：MD5 算法见 1.2，适配器内置 `buildFnosAuthx()`，注入 `authxPrefix` + `clientKey` 即生效（1.1.19 服务端不校验） |
| 2 | ~~`/lyric/list` 返回形态~~ | **已确认**：`{list:[{content,...}]}`，参数名 `trackGUID`；适配器已按此实现并对 `guid` 兜底 |
| 3 | ~~`/playlist/{action}`~~ | **已确认**：create / update / delete / add-track / remove-track，均已落地 |
| 4 | 错误密码的真实错误码 | 目前实测只有「用户不存在」→ `120001`；若真实密码错误另有码，映射表要补 |
| 5 | ~~`/album/artist-detail/list`、`/track/artist-detail/list`、`/genre/list`、`/track/genre-detail/list`~~ | **已确认**：参数分别是 `artistGUID` / `genreGUID`，适配器已用 |
| 6 | `size` 上限 | `fn-music-player` 按 `size=500` 分页拉全库；实测 >2000 会被服务端**静默丢弃、按默认 50 条返回**（不报错） |
| 7 | 转码/HLS 系列是否在个人版固件可用 | 码率切换 |

---

## 附：本次实测记录

- 环境：`https://mmdctjj.fnos.net`（FN Connect 中继），曲库 5 首 / 2 位歌手 / 若干专辑。
- 已实测返回 `code: 0`：`/initialization/state`、`/user/me`、`/track/list`、`/album/list`、`/album/detail`、`/artist/list`、`/playlist/list`、`/track/album-detail/list`、`/search/track`、`/search/album`、`/search/artist`、`/search/playlist`、`/search/suggest`、`/play-history/list`、`/favorite-track/list`。
- 搜索专项（2026-11-10 晚，对齐官方前端一次搜索的四个并发请求）：`q=花粥` 时 track 回 5 条、artist 回 2 条、album 回 2 条、playlist 回 0 条，均 `code: 0`；desktop web 端在 `/__fnos` 代理下逐条验证通过（封面/播放仍走原媒体代理链路）。
- 鉴权专项（2026-11-10 晚补测，参考 `QiaoKes/fn-music-tv`）：

| 请求 | 结果 |
|---|---|
| `GET /sys/config` + `Cookie: mode=relay` | `200 {"code":0,...,"serverName":"AudioDock","serverVersion":"1.1.19"}` |
| `GET /sys/config` 不带 relay cookie | `302` → FN Connect 登录页 |
| `GET /user/me`（无 token） | `401` `{"code":99999,"msg":"INVALID TOKEN"}` |
| `POST /user/password-login`（用户不存在） | `200` `{"code":120001,"msg":"unauthorized, please login again"}` |
| `GET /static/cover?coverId=…`（无 token） | `401` |
| `GET /track/stream?guid=…`（无 token） | `401` |
| 媒体 + `?token=`/`?userToken=`/`?access_token=`/`Cookie: music-token=` | 全部 `401`（只认 Authorization 头） |
| `OPTIONS` 预检 | `200` 但返回 SPA 的 HTML，**无任何 CORS 头** |
- 参数自检方法：响应 `data.sort` 会回显请求的 `sort` 值，可用来确认参数是否被接受。
