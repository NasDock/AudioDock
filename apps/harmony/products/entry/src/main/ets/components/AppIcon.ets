// AppIcon: maps Ionicons-style names used in mobile pages to HarmonyOS
// system SymbolGlyph resources. Ponytail: only names verified to compile in
// the project's HarmonyOS SDK (API 19). Unknown sys.symbol.* names produce
// 10903329 — keep this list tight to the ones that build clean.

export type AppIconName =
  | 'home'
  | 'headphones'
  | 'person'
  | 'person-fill'
  | 'folder'
  | 'camera'
  | 'crown'
  | 'radio'
  | 'arrow-clockwise'
  | 'plus'
  | 'heart'
  | 'heart-fill'
  | 'play'
  | 'pause'
  | 'skip-back'
  | 'skip-forward'
  | 'chevron-down'
  | 'list'
  | 'playlist'
  | 'music-note'
  | 'shuffle'
  | 'repeat'
  | 'repeat-once'
  | 'gear'
  | 'close'
  | 'arrow-up'
  | 'arrow-down'
  | 'locate'
  | 'cloud-download'
  | 'cloud-download-outline'
  | 'grid-outline'
  | 'volume-high'
  | 'refresh'
  | 'trash'
  | 'document'
  | 'chevron-back'
  | 'arrow-forward'
  | 'checkbox'
  | 'square-outline'
  | 'scan'
  | 'list-outline'
  | 'expand'
  | 'contract'
  | 'search'
  | 'server-outline'
  | 'settings-outline'
  | 'cast'
  | 'desktop'
  | 'tablet'
  | 'tv'
  | 'watch'
  | 'speedometer'
  | 'skip-back-outline'
  | 'skip-forward-outline';

const ICON_MAP: Record<AppIconName, Resource> = {
  'home': $r('sys.symbol.house'),
  'headphones': $r('sys.symbol.headphones'),
  'person': $r('sys.symbol.person'),
  // 已同步态填充图标（对齐 mobile Ionicons people 实心）。
  // SF Symbols 标准命名 person.fill → HarmonyOS snake_case person_fill。
  // build 报 10903329 的话降级为 heart-fill。
  'person-fill': $r('sys.symbol.person_fill'),
  'folder': $r('sys.symbol.folder'),
  'camera': $r('sys.symbol.camera'),
  'crown': $r('sys.symbol.crown'),
  'radio': $r('sys.symbol.radio'),
  'arrow-clockwise': $r('sys.symbol.arrow_clockwise'),
  'plus': $r('sys.symbol.plus'),
  'heart': $r('sys.symbol.heart'),
  'heart-fill': $r('sys.symbol.heart_fill'),
  'play': $r('sys.symbol.play_fill'),
  'pause': $r('sys.symbol.pause_fill'),
  'skip-back': $r('sys.symbol.backward_end_fill'),
  'skip-forward': $r('sys.symbol.forward_end_fill'),
  'chevron-down': $r('sys.symbol.chevron_down'),
  'list': $r('sys.symbol.list_bullet'),
  'playlist': $r('sys.symbol.music_note_list'),
  // sys.symbol.music_note 在当前 SDK 不存在（10903329），sys.symbol.music 为纯音乐符号
  'music-note': $r('sys.symbol.music'),
  'shuffle': $r('sys.symbol.shuffle'),
  'repeat': $r('sys.symbol.repeat'),
  'repeat-once': $r('sys.symbol.repeat_1'),
  'gear': $r('sys.symbol.gearshape'),
  'close': $r('sys.symbol.xmark'),
  'arrow-up': $r('sys.symbol.arrow_up'),
  'arrow-down': $r('sys.symbol.arrow_down'),
  'locate': $r('sys.symbol.scope'),
  'cloud-download': $r('sys.symbol.icloud'),
  // 修复：LibraryPage.ets 与 ArtistDetailPage.ets 用到，当前 SDK 没独立 outline 版本，
  // 沿用 icloud（视觉上一致，mobile 也只是 stroke 区别）
  'cloud-download-outline': $r('sys.symbol.icloud'),
  // 修复：LibraryPage.ets 视窗切换按钮，当前 SDK 没 grid/rectanglegrid，
  // 复用 square 当 placeholder（视觉接近"网格"语义）
  'grid-outline': $r('sys.symbol.square'),
  'volume-high': $r('sys.symbol.speaker_wave_3_fill'),
  'refresh': $r('sys.symbol.arrow_clockwise'),
  'trash': $r('sys.symbol.trash'),
  'document': $r('sys.symbol.doc'),
  'chevron-back': $r('sys.symbol.chevron_left'),
  'arrow-forward': $r('sys.symbol.arrow_right'),
  'checkbox': $r('sys.symbol.checkmark_square_fill'),
  'square-outline': $r('sys.symbol.square'),
  // 扫码（对齐 mobile AntDesign scan 取景器框，不是二维码）。
  // viewfinder / qrcode_viewfinder 不存在（10903329），试 barcode_viewfinder。
  'scan': $r('sys.symbol.barcode_viewfinder'),
  // 任务中心入口：复用 list_bullet 强调列表语义
  'list-outline': $r('sys.symbol.list_bullet'),
  // 全屏切换（对齐 mobile Ionicons expand/contract）。
  // 鸿蒙 SDK 通常按 SF Symbols snake_case 命名；若 build 报 10903329，
  // 改成 chevron-up / chevron-down 之类已验证过的也行。
  'expand': $r('sys.symbol.arrow_up_left_and_arrow_down_right'),
  'contract': $r('sys.symbol.arrow_down_right_and_arrow_up_left'),
  // 搜索（SF Symbols 标准名 magnifyingglass；用 search 也行，看 SDK 实现）。
  // build 报 10903329 的话降级为 'list' 或保留原 ⌕ 文本。
  'search': $r('sys.symbol.magnifyingglass'),
  // 资源管理（对齐 mobile Ionicons server-outline → SF Symbols server）。
  // SF Symbols 标准名 server / external_drive / network 在当前 SDK 都不存在（10903329），
  // 改用 archivebox（归档箱，视觉接近"资源/服务器"）。
  'server-outline': $r('sys.symbol.archivebox'),
  // 设置（对齐 mobile Ionicons settings-outline → SF Symbols gearshape）。
  // 与 'gear' 同源但语义不同（个人页右上入口 vs 内部菜单"评价"等），映射统一。
  'settings-outline': $r('sys.symbol.gearshape'),
  // 播放流转/投屏（流转到设备的箭头语义）
  'cast': $r('sys.symbol.paperplane_fill'),
  // 在线设备平台图标。SDK 缺 desktopcomputer/ipad/tv/applewatch（10903329），
  // 用已验证存在的符号做语义近似替代。
  'desktop': $r('sys.symbol.display'),
  'tablet': $r('sys.symbol.rectangle'),
  'tv': $r('sys.symbol.play_fill'),
  'watch': $r('sys.symbol.clock_fill'),
  // 倍速（对齐 mobile Ionicons speedometer-outline）。SDK 无 gauge/speedometer（10903329），
  // 用 clock（已验证存在）表达"速度/计时"语义近似。
  'speedometer': $r('sys.symbol.clock'),
  // 片头/片尾跳过（对齐 mobile Ionicons play-skip-back/forward-outline）。
  // SDK 无 backward_end/forward_end 线框版（10903329），沿用已验证的 fill 版（与上一首/下一首同图）。
  'skip-back-outline': $r('sys.symbol.backward_end_fill'),
  'skip-forward-outline': $r('sys.symbol.forward_end_fill'),
};

export function getIconResource(name: AppIconName): Resource {
  return ICON_MAP[name];
}

@Component
export struct AppIcon {
  @Prop name: AppIconName = 'plus';
  @Prop iconSize: number = 20;
  @Prop color: string = '#000000';

  build() {
    SymbolGlyph(getIconResource(this.name))
      .fontSize(this.iconSize)
      .fontColor([this.color])
  }
}