import { generateMockLyrics, mockData } from "../mockUtils";
import { IMusicAdapter } from "./interface";
import { NativeMusicAdapter } from "./native";
import { SubsonicMusicAdapter } from "./subsonic";
import { SubsonicConfig } from "./subsonic/client";

let currentAdapter: IMusicAdapter = new NativeMusicAdapter();

export const getAdapter = (): IMusicAdapter => {
  return new Proxy(currentAdapter, {
    get(target, prop, receiver) {
      const val = Reflect.get(target, prop, receiver);
      if (typeof val === 'object' && val !== null) {
          // Wrap sub-objects (like track, album, etc. namespaces)
          return new Proxy(val, {
              get(subTarget, subProp, subReceiver) {
                  const subVal = Reflect.get(subTarget, subProp, subReceiver);
                  if (typeof subVal === 'function') {
                      return (...args: any[]) => {
                          const result = subVal.apply(subTarget, args);
                          if (result instanceof Promise) {
                              return result.then(data => {
                                  // Special case for lyrics
                                  if (subProp === 'getLyrics' && typeof data === 'string') {
                                      const seed = String(args[0] || 'default');
                                      return generateMockLyrics(seed);
                                  }
                                  return mockData(data);
                              });
                          }
                          return mockData(result);
                      };
                  }
                  return subVal;
              }
          });
      }
      return val;
    }
  });
};

export const useNativeAdapter = () => {
  currentAdapter = new NativeMusicAdapter();
};

export const useSubsonicAdapter = (config?: SubsonicConfig) => {
  currentAdapter = new SubsonicMusicAdapter(config);
};
