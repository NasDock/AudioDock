/**
 * 卡片矢量图标（对齐 Material Icons / iOS SF Symbols 视觉比例）。
 *
 * HarmonyOS 卡片没有系统图标库。之前的 Path 方案（viewPort/scale/坐标预缩放）
 * 在卡片渲染管线全部不生效，改用 SVG 资源 + Image 组件：
 *   - SVG 作为 $r('app.media.xxx') 打进 HAP，卡片进程直接读，无网络/文件 IO
 *   - Image 的 .width/.height 天然生效（标准布局属性，无渲染管线差异）
 *   - .fillColor(color) 给 SVG 统一着色，一套资源适配所有颜色
 *
 * 所有 SVG 路径来自 Material Design Icons 标准 24x24 fill 路径。
 */

@Builder
export function WidgetIcon(name: string, size: number, color: string) {
  if (name === 'play') {
    // Material: play_arrow
    Image($r('app.media.ic_play'))
      .width(size)
      .height(size)
      .fillColor(color);
  } else if (name === 'pause') {
    // Material: pause
    Image($r('app.media.ic_pause'))
      .width(size)
      .height(size)
      .fillColor(color);
  } else if (name === 'prev') {
    // Material: skip_previous
    Image($r('app.media.ic_prev'))
      .width(size)
      .height(size)
      .fillColor(color);
  } else if (name === 'next') {
    // Material: skip_next
    Image($r('app.media.ic_next'))
      .width(size)
      .height(size)
      .fillColor(color);
  } else if (name === 'heart') {
    // Material: favorite_border
    Image($r('app.media.ic_heart'))
      .width(size)
      .height(size)
      .fillColor(color);
  } else if (name === 'heart.fill') {
    // Material: favorite
    Image($r('app.media.ic_heart_fill'))
      .width(size)
      .height(size)
      .fillColor(color);
  } else if (name === 'shuffle') {
    // Material: shuffle
    Image($r('app.media.ic_shuffle'))
      .width(size)
      .height(size)
      .fillColor(color);
  } else if (name === 'repeat') {
    // Material: repeat
    Image($r('app.media.ic_repeat'))
      .width(size)
      .height(size)
      .fillColor(color);
  } else if (name === 'repeat.1') {
    // Material: repeat_one
    Image($r('app.media.ic_repeat_1'))
      .width(size)
      .height(size)
      .fillColor(color);
  } else if (name === 'list') {
    // Material: format_list_bulleted
    Image($r('app.media.ic_list'))
      .width(size)
      .height(size)
      .fillColor(color);
  } else if (name === 'music') {
    // Material: music_note
    Image($r('app.media.ic_music'))
      .width(size)
      .height(size)
      .fillColor(color);
  } else if (name === 'crown') {
    // Material: workspace_premium（皇冠/会员）
    Image($r('app.media.ic_crown'))
      .width(size)
      .height(size)
      .fillColor(color);
  } else if (name === 'refresh') {
    // Material: refresh
    Image($r('app.media.ic_refresh'))
      .width(size)
      .height(size)
      .fillColor(color);
  } else {
    // fallback: 占位圆点
    Circle({ width: size, height: size })
      .fill(color)
      .fillOpacity(0.3);
  }
}
