export interface LyricLine {
  time: number;
  text: string;
}

export const parseLyrics = (lyrics: string): LyricLine[] => {
  if (!lyrics) return [];

  const lines = lyrics.split("\n");
  const parsed: LyricLine[] = [];

  for (const line of lines) {
    const match = line.match(/\[(\d+):(\d+)(?:([\.:])(\d+))?\](.*)/);
    if (match) {
      const part1 = parseInt(match[1], 10);
      const part2 = parseInt(match[2], 10);
      const separator = match[3];
      const part3Str = match[4];
      const text = match[5].trim();

      let time = 0;
      if (separator === ":" && part3Str) {
        const hours = part1;
        const minutes = part2;
        const seconds = parseInt(part3Str, 10);
        time = hours * 3600 + minutes * 60 + seconds;
      } else {
        const minutes = part1;
        const seconds = part2;
        const milliseconds = part3Str ? parseInt(part3Str.padEnd(3, "0"), 10) : 0;
        time = minutes * 60 + seconds + milliseconds / 1000;
      }

      if (text) {
        parsed.push({ time, text });
      }
    } else if (line.trim() && !line.startsWith("[")) {
      parsed.push({ time: 0, text: line.trim() });
    }
  }

  return parsed.sort((a, b) => a.time - b.time);
};

export const getActiveLyricLine = (lyrics: string | null | undefined, position: number): string => {
  if (!lyrics) return "";
  const lines = parseLyrics(lyrics);
  if (lines.length === 0) return "";

  let activeIndex = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const current = lines[i];
    const next = lines[i + 1];
    if (position >= current.time && (!next || position < next.time)) {
      activeIndex = i;
      break;
    }
  }

  return lines[activeIndex]?.text ?? "";
};
