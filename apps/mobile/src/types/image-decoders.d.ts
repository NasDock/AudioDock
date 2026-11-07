declare module "jpeg-js" {
  export interface DecodedJpeg {
    width: number;
    height: number;
    /** RGBA，长度为 width * height * 4 */
    data: Uint8Array;
  }
  export function decode(
    buffer: Uint8Array | ArrayBuffer,
    opts?: {
      useTArray?: boolean;
      formatAsRGBA?: boolean;
      maxResolutionInMP?: number;
      maxMemoryUsageInMB?: number;
    },
  ): DecodedJpeg;
}

declare module "upng-js" {
  export interface DecodedPng {
    width: number;
    height: number;
    depth: number;
    ctype: number;
    frames: number;
    data: Uint8Array;
  }
  export function decode(buffer: ArrayBuffer): DecodedPng;
  /** 返回每帧的 RGBA 数据（ArrayBuffer）；不传帧索引时返回全部帧 */
  export function toRGBA8(img: DecodedPng, frame?: number): ArrayBuffer[];
}
