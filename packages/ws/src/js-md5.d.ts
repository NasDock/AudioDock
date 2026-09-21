/**
 * js-md5 的本地类型声明。
 * js-md5@0.8.3 自带 index.d.ts，但 package.json 未声明 "types" 字段，
 * father 的 dts 生成无法解析，这里显式声明模块类型。
 */
declare module 'js-md5' {
  /** 计算字符串的 MD5，返回 32 位小写 hex。支持 UTF-8（含中文）。 */
  export function md5(message: string): string;
  const md5Default: (message: string) => string;
  export default md5Default;
}
