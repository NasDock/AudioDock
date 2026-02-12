export * from "./album";
export * from "./artist";
export * from "./auth";
export * from "./folder";
export * from "./import";
export * from "./models";
export * from "./playlist";
export * from "./request";
export * from "./search";

export * from "./adapter/manager";
export * from "./admin";
export * from "./config";
export * from "./plus";
export * from "./search-record";
export * from "./track";
export * from "./tts";
export * from "./user";
export * from "./userAudiobookHistory";

export const SOURCEMAP = {
    AudioDock: "audiodock",
    Subsonic: "subsonic",
    Emby: "emby",
}

export const SOURCETIPSMAP = {
    AudioDock: "所有支持 AudioDock 官方服务端",
    Subsonic: "所有支持 Subsonic 协议的服务端，例如：Navidrome、Gonic 等",
    Emby: "所有支持 Emby 协议的服务端",
}