
import { Album, Artist, Track } from "./models";

function getStableHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash |= 0; // Convert to 32bit integer
    }
    // Return absolute positive value as string to be safe with URLs
    return Math.abs(hash).toString();
}

const unsplashIds = [
  "1508700115892-45ecd05ae2ad", // Headphones
  "1511379938547-c1f69419868d", // Studio
  "1506157786151-b8491531f063", // Bokeh
  "1493225255756-d9584f8606e9", // Vinyl
  "1419242902214-272b3f66ee7a", // Starry Sky
];

const getMockUrlFromSeed = (seed: string, size = 500) => {
    const hash = parseInt(getStableHash(seed));
    const id = unsplashIds[hash % unsplashIds.length];
    return `https://images.unsplash.com/photo-${id}?w=${size}&h=${size}&fit=crop`;
};

const getMockCover = (seed: string) => getMockUrlFromSeed(seed, 500);
const getMockAvatar = (seed: string) => getMockUrlFromSeed("avatar_" + seed, 300);

const chineseFirstNames = ["张", "王", "李", "赵", "陈", "林", "周", "吴", "徐", "孙", "马", "朱", "胡", "郭", "何", "高", "罗", "郑", "梁", "谢"];
const chineseLastNames = ["伟", "芳", "娜", "秀英", "敏", "静", "丽", "强", "磊", "洋", "勇", "杰", "娟", "涛", "明", "超", "秀兰", "霞", "平", "刚"];

const albumNames = [
  "时光倒流", "梦境边缘", "城市回响", "夏日长河", "午夜飞行", "云端漫步", "昨日重现", "星空之下",
  "孤独的信徒", "破晓时分", "无声的告别", "热带风暴", "冬日物语", "幻夜", "蓝色森林", "远方的呼唤"
];

const trackNames = [
  "风的记忆", "雨中的街", "霓虹之下", "碎梦", "失眠夜", "远行", "海浪声", "告白",
  "流浪者", "最后一次", "最初的爱", "遗忘", "寻找", "归途", "瞬息全宇宙", "平行时空"
];

const mockLyrics = [
  "这是第一句歌词，那是第二句歌词。",
  "在这喧嚣的世界里，寻找那一抹宁静。",
  "风吹过了山谷，带走了我的思绪。",
  "夜幕降临，星辰闪烁，梦在呼唤。",
  "漫步在雨后的街道，闻到泥土的气息。",
  "时光悄悄流逝，带不走那段 memory。",
  "如果可以重来，我依然会选择你。",
  "远方的山岗上，开满了不知名的野花。"
];

function getRandomInt(max: number) {
  return Math.floor(Math.random() * max);
}

function getRandomElement<T>(array: T[]): T {
  return array[getRandomInt(array.length)];
}

function seedRandom(seed: string | number) {
    const s = String(seed);
    const hashStr = getStableHash(s);
    let hash = parseInt(hashStr);
    const x = Math.sin(hash++) * 10000;
    return x - Math.floor(x);
}

function getSeededElement<T>(array: T[], seed: string | number): T {
    const r = seedRandom(seed);
    return array[Math.floor(r * array.length)];
}


export const generateMockLyrics = (seed: string) => {
    return Array.from({ length: 15 }).map((_, i) => `[00:${(i * 5).toString().padStart(2, '0')}.00] ${getSeededElement(mockLyrics, seed + "_" + i)}`).join('\n');
};

export const mockTrack = (track: Track): Track => {
  if (!track) return track;
  const seed = String(track.id || track.path);
  const mockedName = getSeededElement(trackNames, seed);
  const mockedAlbum = getSeededElement(albumNames, seed);
  const mockedArtist = `${getSeededElement(chineseFirstNames, seed)}${getSeededElement(chineseLastNames, seed)}`;
  
  return {
    ...track,
    name: mockedName,
    artist: mockedArtist,
    album: mockedAlbum,
    cover: getMockCover(mockedAlbum), // 使用 专辑名 作为种子，这样同一专辑的歌曲封面一致
    lyrics: generateMockLyrics(seed),
    artistEntity: track.artistEntity ? mockArtist(track.artistEntity) : undefined as any,
    albumEntity: track.albumEntity ? mockAlbum(track.albumEntity) : undefined as any,
  };
};

export const mockAlbum = (album: Album): Album => {
  if (!album) return album;
  const seed = String(album.id || album.name);
  const mockedName = getSeededElement(albumNames, seed);
  
  return {
    ...album,
    name: mockedName,
    artist: `${getSeededElement(chineseFirstNames, seed)}${getSeededElement(chineseLastNames, seed)}`,
    cover: getMockCover(mockedName), // 使用 专辑名 作为种子，方便进行主题匹配和覆盖
  };
};

export const mockArtist = (artist: Artist): Artist => {
  if (!artist) return artist;
  const seed = String(artist.id || artist.name);
  const mockedName = `${getSeededElement(chineseFirstNames, seed)}${getSeededElement(chineseLastNames, seed)}`;
  
  return {
    ...artist,
    name: mockedName,
    avatar: getMockAvatar(mockedName), // 使用 艺人名 作为种子
    bg_cover: getMockCover(mockedName + "_bg"),
  };
};


export const mockData = <T>(data: T): T => {
  if (!data || (data as any)._isMocked) return data;

  // Handle common response structures
  if ((data as any).code !== undefined && (data as any).data !== undefined) {
    return {
      ...data,
      data: mockData((data as any).data)
    } as any;
  }

  // Handle list structures
  if (Array.isArray((data as any).list)) {
      return {
          ...data,
          list: (data as any).list.map((item: any) => mockData(item))
      } as any;
  }

  if (Array.isArray(data)) {
    return data.map(item => mockData(item)) as any;
  }

  if (typeof data === 'object') {
    let mocked = data;
    let handled = false;

    // Detect Track
    if ((data as any).path !== undefined && ((data as any).artist !== undefined || (data as any).album !== undefined)) {
      mocked = mockTrack(data as any) as any;
      handled = true;
    } 
    // Detect Album
    else if ((data as any).name !== undefined && (data as any).cover !== undefined && (data as any).type !== undefined) {
      mocked = mockAlbum(data as any) as any;
      handled = true;
    }
    // Detect Artist
    else if ((data as any).avatar !== undefined && (data as any).name !== undefined) {
        mocked = mockArtist(data as any) as any;
        handled = true;
    }
    
    // Mark as mocked to prevent recursive loops or double processing
    if (mocked && typeof mocked === 'object') {
        (mocked as any)._isMocked = true;
    }

    // Always process children even if not a direct model match (for nested structures like SearchResults)
    if (!handled) {
        const result: any = {};
        for (const key in data) {
          result[key] = mockData((data as any)[key]);
        }
        return result;
    }
    return mocked;
  }
  return data;
};
