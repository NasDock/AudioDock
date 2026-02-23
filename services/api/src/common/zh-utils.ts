const chineseConv = require('chinese-conv');

export function toSimplified(text: string): string {
  if (!text) return text;
  return chineseConv.sify(text);
}
