export * from "./adapter/manager";
export * from "./accessToken";
export * from "./admin";
export * from "./album";
export * from "./artist";
export * from "./asr";
export * from "./auth";
export * from "./collection";
export * from "./config";
export * from "./folder";
export * from "./import";
export * from "./llm";
export * from "./llmConfig";
export * from "./loadMore";
export * from "./metadataPlugins";
export * from "./mi";
export * from "./models";
export * from "./mv";
export * from "./platform";
export * from "./playlist";
export * from "./plus";
export * from "./request";
export * from "./scan-login";
export * from "./search";
export * from "./search-record";
export * from "./taskCenter";
export * from "./track";
export * from "./tracking";
export * from "./tts";
export * from "./ttsConfig";
export * from "./user";
export * from "./userAudiobookHistory";
export * from "./webdav";

export const SOURCEMAP = {
    AudioDock: "audiodock",
    Subsonic: "subsonic",
    Emby: "emby",
    // 飞牛 fnOS 自带的音乐应用（trim.music）。
    // desktop / mobile / mini 都用这份清单渲染数据源列表，mini 侧有自己的本地
    // 清单（apps/mini/src/utils/sourceUtils.ts）不含飞牛，所以放这里是安全的。
    Feiniu: "fnos",
    // Audiobookshelf：自有 REST API（/api + Bearer token），内容固定为有声书
    Audiobookshelf: "audiobookshelf",
}

export const SOURCETIPSMAP = {
    AudioDock: "所有支持 AudioDock 官方服务端",
    Subsonic: "所有支持 Subsonic 协议的服务端，例如：Navidrome、Gonic 等",
    Emby: "所有支持 Emby 协议的服务端",
    Feiniu: "飞牛 fnOS 自带的音乐应用（trim.music），地址填 NAS，如 http://192.168.1.10:5666",
    Audiobookshelf: "Audiobookshelf 有声书服务，地址填服务域名（支持 /audiobookshelf 子路径）",
}
