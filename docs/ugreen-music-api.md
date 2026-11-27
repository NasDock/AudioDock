# 绿联音乐（UGOS Pro com.ugreen.music）接口与接入方案

> 基于 UGOS Pro 1.15.1.0127（DH2600，音乐应用 com.ugreen.music_1953）实测，2026-11-27。
> 所有接口均在 NAS 网关 `https://<host>/ugreen/v1` 下，信封统一 `{code, msg, data}`，`code === 200` 成功。

## 1. 网关与鉴权

### 1.1 特点（与飞牛的关键差异）

- **CORS 完全开放**：`Access-Control-Allow-Origin: *` + `Expose-Headers: *`，desktop web 可直连，**不需要代理通道**。
- **token 走 query 参数**：登录拿到 `data.token`（api_token），之后所有 API 与媒体地址都拼 `?token=<api_token>`。媒体地址自带凭据，**不需要媒体代理**（与 Subsonic 同构）。
- 音频直链支持 `Range`（实测 206），可直接给 `<audio>` / AVPlayer / RNTP 用。

### 1.2 登录流程

```
POST /ugreen/v1/verify/check        {"username":"mmdctjj"}
  → 响应头 X-Rsa-Token: <base64 PEM 公钥>   （body 恒为 {code:200,data:{}}）

POST /ugreen/v1/verify/login
  {"username":"mmdctjj","password":<RSA_PKCS1_v1.5(公钥, 明文密码) base64>,
   "keepalive":true,"otp":true,"is_simple":true}
  → data.token        会话 token（query 参数用）
  → data.static_token 静态资源 token（is_ugk 时官方前端拼 ugk=<static_token>，实测 token= 同样可用）
  → data.uid / username / role / nas_name / is_ugk / model / sn ...
```

- 密码用 check 返回的公钥做 **RSA PKCS#1 v1.5** 加密后 base64。
- 官方前端每次登录都重新 check 拿公钥（公钥会轮换），不要缓存。
- 登录失败返回非 200 code + msg（如账号或密码错误）。

### 1.3 错误码（实测）

| code | 含义 |
|---|---|
| 200 | 成功 |
| 1005 | Parameter error!（参数缺失/不合法，如 sort_type 不在该接口允许集合内） |
| 1024 | Login has expired（token 失效/未带） |
| 3003 | 歌单不存在（官方前端特判） |
| 9405 | 未授权/参数无效（未带 token 时所有 music 接口返回此码） |
| 9999 | Operation failed |

## 2. 分页与排序

- 分页参数：`page`（1 起）+ `page_size`；响应 `total_num` + `is_last_page`。
- 排序：`sort_type` + `asc`（1 升 / 0 降）。
- `sort_type` 值映射（官方前端 valueMap）：

| 值 | 语义 |
|---|---|
| 0 | 添加时间（byaddtime） |
| 1 | 名称（byname） |
| 2 | 歌手（bysinger） |
| 3 | 碟号（bydisc） |
| 4 | 年份（byyear） |
| 5 | 手动排序（byhand） |
| 6 | 收藏时间（bycollecttime） |
| 7 | 加入歌单时间（byaddtosheettime） |

- **注意**：`collect/v2`、`songlist/by_id/v2` 不接受 `sort_type=0`（报 1005/9405）。收藏列表用 6，歌单详情用 1。

## 3. 数据模型（实测样本字段）

### 3.1 曲目（file_arr 元素）

```jsonc
{
  "audio_id": 3743,
  "resource_id": "ed6cd60f...",
  "song_title": "248.地底世界之幽潜重泉 11 阎王爷都认不出",
  "audio_cover_url": "/volume1/@appstore/com.ugreen.music/data/cover/xxx.jpg", // get_file 的 file_path
  "duration": 698,               // 秒
  "file_move_time": 1713630454,  // 秒，添加时间
  "file_path": "/volume1/迅雷下载/.../248.xxx.mp3", // 播放地址用
  "file_size_byte": 11261635,
  "file_extension": "mp3",
  "serial_number": 0,
  "singer_id": 243, "singer_name": "通航飞行员",
  "singer_arr": [{"singer_id":197,"singer_name":"通航飞行员"}],
  "album_id": 222, "album_name": "天下霸唱地底世界四部合集",
  "year": "", "bit_rate": "128kbps",
  "audio_type": 1, "validity": 1,  // validity 1=有效
  "collected": false,              // 是否已收藏
  "update_time": 1740763361        // 秒，封面缓存击穿参数
}
```

### 3.2 专辑（album_arr 元素）

`album_id, album_name, album_cover_url, singer_id, singer_name, singer_arr, year, default_cover_id, total_num, collected`

### 3.3 歌手（singer_arr 元素）

`singer_id, singer_name, pinyin_first, create_time, total_num`（头像无字段，用专辑封面兜底或留空）

### 3.4 歌单（songlist_arr 元素）

`songlist_id, uid, title, cover_url, intro, create_time(ISO), update_time(秒), total_num, with_valid_song`

## 4. 接口清单

### 4.1 用户/初始化

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/ugreen/v1/verify/check` | 拿 RSA 公钥（响应头 `X-Rsa-Token`），免登录 |
| POST | `/ugreen/v1/verify/login` | 密码登录，返回 api_token |
| GET | `/ugreen/v1/user/current/user` | 当前用户（uid/username/role/...） |

### 4.2 曲库

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/ugreen/v1/music/library/all?page=&page_size=&sort_type=&asc=` | 全部曲目 |
| GET | `/ugreen/v1/music/library/by_album?page=&page_size=` | 专辑列表 |
| GET | `/ugreen/v1/music/library/by_singer?page=&page_size=` | 歌手列表 |
| GET | `/ugreen/v1/music/library/by_genre?page=&page_size=` | 类型列表 |
| GET | `/ugreen/v1/music/library/by_folder?page=&page_size=` | 文件夹列表 |
| GET | `/ugreen/v1/music/folder/tree?path=/&page=&page_size=&sort_type=&asc=` | 文件夹浏览 |
| GET | `/ugreen/v1/music/album/v2?album_id=&page=&page_size=&sort_type=&asc=` | 专辑详情+曲目（`album_info` + `file_arr`） |
| GET | `/ugreen/v1/music/singer?singer_id=&page=&page_size=&split_version_flag=true&sort_type=&asc=&search_type=` | 歌手详情（`singer_info` + `album_arr`，曲目按专辑拆分） |
| GET | `/ugreen/v1/music/singer/statistics?singer_id=` | 歌手曲目/专辑计数 |
| GET | `/ugreen/v1/music/all_genre` | 全部类型 |
| GET | `/ugreen/v1/music/genre?genre_id=&page=&page_size=&sort_type=&asc=` | 类型详情 |
| GET | `/ugreen/v1/music/song/info?audio_id=` | 单曲信息（`music_file`，含 `lyric_url` 当存在时） |
| GET | `/ugreen/v1/music/song/info_by_path?path=` | 按路径取单曲信息 |
| GET | `/ugreen/v1/music/related_album?excluded_album_id=&singer_id=&total=12` | 相关专辑 |

### 4.3 歌单

| 方法 | 路径 | payload | 说明 |
|---|---|---|---|
| GET | `/ugreen/v1/music/songlist/all?has_invalid_song=true` | | 歌单列表 |
| GET | `/ugreen/v1/music/songlist/by_id/v2?songlist_id=&sort_type=1&asc=` | | 歌单详情（`songlist_info` + 全量 `file_arr`，**sort_type 不能为 0**） |
| POST | `/ugreen/v1/music/songlist/add` | `{songlist:{title}}` | 新建 → `{songlist_id}` |
| POST | `/ugreen/v1/music/songlist/modify` | `{songlist:{songlist_id,uid,title,cover_url,intro}}` | 改名（嵌套整个对象） |
| POST | `/ugreen/v1/music/songlist/del` | `{del_type:2, songlist_id_arr:[id]}` | 删除 |
| POST | `/ugreen/v1/music/songlist/content/add` | `{songlist_id_arr:[pid], audio_id_arr:[...]}` | 加曲目（文件夹用 `dir_id_arr`+`add_type:1`） |
| POST | `/ugreen/v1/music/songlist/content/del` | `{songlist_id, del_type:2, audio_id_arr:[...]}` | 移除曲目 |

### 4.4 收藏 / 最近播放

| 方法 | 路径 | payload | 说明 |
|---|---|---|---|
| GET | `/ugreen/v1/music/collect/v2?page=&page_size=&sort_type=6&asc=0&has_invalid_song=true` | | 收藏列表（**sort_type 不能为 0**） |
| POST | `/ugreen/v1/music/collect/add` | `{audio_id_arr:[...]}` | 收藏 |
| POST | `/ugreen/v1/music/collect/del` | `{del_type:2, audio_collect_id_arr:[...]}` | 取消收藏 |
| GET | `/ugreen/v1/music/recently_played` | | 最近播放（`file_arr`，total_num≈500） |
| POST | `/ugreen/v1/music/recently_played/add` | `{audio_id}` | 写播放记录 |
| POST | `/ugreen/v1/music/recently_played/del` | | 删播放记录 |

### 4.5 搜索

`GET /ugreen/v1/music/search/by_type/ai?keyword=&search_type=&page=&page_size=&split_version_flag=true&has_invalid_song=true&sort_type=`

| search_type | 返回字段 |
|---|---|
| 1 | `file_arr`（曲目，匹配标题/专辑名，**不匹配歌手名**） |
| 2 | `album_arr` |
| 3 | `singer_arr` |
| 4 | `songlist_arr` |

另有 `GET /ugreen/v1/music/search/statistics?keyword=&search_type=&search_engine=1`（计数），暂不用。

### 4.6 媒体资源（均 token query 鉴权）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/ugreen/v1/music/get_file?file_path=<urlencoded>&update_time=<秒>&token=` | 封面图（image/jpeg）与**音频直链**（支持 Range，audio/mpeg） |
| GET | `/ugreen/v1/music/get_file_with_token?file_path=<urlencoded>&token=` | 歌词文本（`song/info` 的 `music_file.lyric_url`） |
| POST | `/ugreen/v3/stream/transcode/music/create` | 转码任务（官方 web 播放器 HLS 用，本接入不用） |
| GET | `/ugreen/v3/stream/transcode/music/m3u8` | HLS 流（不用） |

## 5. 能力差异与模拟策略

| 能力 | 绿联侧 | AudioDock 适配策略 |
|---|---|---|
| 有声书模式 | 无 | 强制 MUSIC（同飞牛 `enforceSourcePlayMode`） |
| 推荐接口 | 无 | `library/all?sort_type=0&asc=0`（最近添加）模拟，同飞牛 |
| 注册 | 无（UGOS 系统账号） | 隐藏注册入口 |
| 歌手内全部曲目 | 只有按专辑拆分的视图 | 先 `singer` 取 `album_arr`，再逐专辑 `album/v2` 聚合 |
| 歌词 | 单曲 `song/info.lyric_url`，列表不带 | 切歌懒加载 + 内存缓存（同飞牛） |
| 搜索历史 | 无服务端接口 | 端侧本地实现（复用 FnosSearchRecordAdapter） |
| 播放历史 | 有（recently_played） | 播放时 `recently_played/add` 上报 |
| MV / collection | 无 | 空实现，UI 隐藏入口 |

## 6. 接入落点

- `packages/services/src/adapter/ugreen/`：适配器（照 fnos 结构，去掉 transport/mediaProxy/authx——CORS 开放 + token query）
- `packages/services/src/adapter/manager.ts`：`useUgreenAdapter`
- `packages/services/src/index.ts`：`SOURCEMAP.UGreen = "ugreen"`
- desktop：`constants/sources.ts`、登录/切源分支、`utils/isUgreenSource`、`enforceSourcePlayMode`、歌词懒加载条件
- mobile / harmony：本次先 desktop，mobile/harmony 后续按 fnos 落点表平移（无代理需求，媒体 URL 直连）
