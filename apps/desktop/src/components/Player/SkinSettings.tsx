import { FormatPainterOutlined } from "@ant-design/icons";
import { Flex, Popover, Segmented, Slider, Typography } from "antd";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  usePlayerSkinStore,
  type CoverStyle,
  type LyricsAlign,
} from "../../store/playerSkin";

const { Text } = Typography;

/**
 * 播放详情页皮肤设置（内置插件层）：
 * 播放器样式（默认/黑胶）、歌词对齐（左/中/右）、歌词字体大小。
 * 与 VIP 用户插件走同一套 --ad-detail-* 变量，用户插件优先级更高。
 */
const SkinSettings: React.FC<{ className?: string }> = ({ className }) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const {
    coverStyle,
    lyricsAlign,
    lyricsFontSize,
    setCoverStyle,
    setLyricsAlign,
    setLyricsFontSize,
  } = usePlayerSkinStore();

  const content = (
    <Flex vertical gap={16} style={{ width: 280, padding: "4px 0" }}>
      <Flex vertical gap={8}>
        <Text type="secondary" style={{ fontSize: 12 }}>
          {t("player.playerStyle")}
        </Text>
        <Segmented
          block
          value={coverStyle}
          onChange={(v) => setCoverStyle(v as CoverStyle)}
          options={[
            { label: t("player.styleDefault"), value: "square" },
            { label: t("player.styleVinyl"), value: "vinyl" },
          ]}
        />
      </Flex>
      <Flex vertical gap={8}>
        <Text type="secondary" style={{ fontSize: 12 }}>
          {t("player.lyricsAlign")}
        </Text>
        <Segmented
          block
          value={lyricsAlign}
          onChange={(v) => setLyricsAlign(v as LyricsAlign)}
          options={[
            { label: t("player.alignLeft"), value: "left" },
            { label: t("player.alignCenter"), value: "center" },
            { label: t("player.alignRight"), value: "right" },
          ]}
        />
      </Flex>
      <Flex vertical gap={8}>
        <Flex justify="space-between" align="center">
          <Text type="secondary" style={{ fontSize: 12 }}>
            {t("player.lyricsFontSize")}
          </Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {lyricsFontSize}px
          </Text>
        </Flex>
        <Slider
          min={12}
          max={28}
          value={lyricsFontSize}
          onChange={setLyricsFontSize}
          tooltip={{ open: false }}
        />
      </Flex>
    </Flex>
  );

  return (
    <Popover
      content={content}
      title={t("player.skinSettings")}
      trigger="click"
      placement="topRight"
      open={open}
      onOpenChange={setOpen}
    >
      <FormatPainterOutlined className={className} style={{ fontSize: 20 }} />
    </Popover>
  );
};

export default SkinSettings;
