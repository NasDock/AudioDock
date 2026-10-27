import {
  CloudDownloadOutlined,
  DeleteOutlined,
  HeartFilled,
  HeartOutlined,
  MoreOutlined,
  PauseCircleFilled,
  PlayCircleFilled,
  PlayCircleOutlined,
  PlusOutlined,
} from "@ant-design/icons";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  addTrackToPlaylist,
  deleteTrack,
  getDeletionImpact,
  getPlaylists,
  type Playlist,
} from "@soundx/services";
import { Checkbox, Dropdown, type MenuProps, Modal, Typography } from "antd";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMessage } from "../../context/MessageContext";
import { type Track, TrackSource, TrackType } from "../../models";
import { downloadTrack } from "../../services/downloadManager";
import { resolveArtworkUri } from "../../services/trackResolver";
import { useAuthStore } from "../../store/auth";
import { type PlaylistSource, usePlayerStore } from "../../store/player";
import { formatDuration } from "../../utils/formatDuration";
import { usePlayMode } from "../../utils/playMode";
import LazyImage from "../LazyImage";
import PlayingIndicator from "../PlayingIndicator";
import styles from "./index.module.less";

const { Text } = Typography;

export interface TrackListProps {
  tracks: Track[];
  loading?: boolean;
  type?: TrackType;
  showIndex?: boolean;
  showCover?: boolean;
  showArtist?: boolean;
  showAlbum?: boolean;
  showSource?: boolean;
  showActions?: boolean;
  showDuration?: boolean;
  onPlay?: (track: Track, tracks: Track[]) => void;
  onRefresh?: () => void;
  /** 由调用方控制的已选 track id 列表（自己实现 rowSelection 时使用） */
  selectedIds?: Array<number | string>;
  onSelectChange?: (ids: Array<number | string>) => void;
  /** 兼容 antd rowSelection（fallback：未传 selectedIds 时使用） */
  rowSelection?: any;
  albumId?: number | string;
  playlistSource?: PlaylistSource;
}

const ROW_HEIGHT = 56;
const COVER_WIDTH = 30;
const COVER_HEIGHT = 30;

function buildGridTemplate(opts: {
  showIndex: boolean;
  showCover: boolean;
  showSelect: boolean;
  showArtist: boolean;
  showAlbum: boolean;
  showSource: boolean;
  isAudiobook: boolean;
  showDuration: boolean;
  showActions: boolean;
}): string {
  const cols: string[] = [];
  if (opts.showSelect) cols.push("36px");
  if (opts.showIndex) cols.push("50px");
  if (opts.showCover) cols.push("70px");
  cols.push("1fr"); // title 弹性
  if (opts.showArtist) cols.push("minmax(120px, 1fr)");
  if (opts.showAlbum) cols.push("minmax(120px, 1fr)");
  if (opts.showSource) cols.push("90px");
  if (opts.isAudiobook) cols.push("70px"); // progress
  if (opts.showDuration) cols.push("80px");
  if (opts.showActions) cols.push("44px");
  return cols.join(" ");
}

const TrackList: React.FC<TrackListProps> = ({
  tracks,
  loading = false,
  type,
  showIndex = true,
  showCover = true,
  showArtist = false,
  showAlbum = false,
  showSource = false,
  showActions = true,
  showDuration = true,
  onPlay,
  onRefresh,
  selectedIds,
  onSelectChange,
  rowSelection,
  albumId,
  playlistSource,
}) => {
  const message = useMessage();
  const { t } = useTranslation();
  const { user } = useAuthStore();
  const {
    play,
    setPlaylist,
    currentTrack,
    isPlaying,
    pause,
    removeTrack,
    toggleLike,
  } = usePlayerStore();
  const { mode } = usePlayMode();

  const [isAddToPlaylistModalOpen, setIsAddToPlaylistModalOpen] =
    useState(false);
  const [selectedTrack, setSelectedTrack] = useState<Track | null>(null);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [modalApi, contextHolder] = Modal.useModal();

  const parentRef = useRef<HTMLDivElement>(null);

  // 内部受控选择态（若未传 selectedIds / onSelectChange）
  const [internalSelected, setInternalSelected] = useState<Array<
    number | string
  >>([]);
  // 两种受控方式：selectedIds/onSelectChange（直连），或 antd 风格 rowSelection
  // （之前 rowSelection 只当开关用、状态不同步，导致 Songs 页已选数恒为 0）
  const isDirectControlled =
    Array.isArray(selectedIds) && typeof onSelectChange === "function";
  const isRowSelectionControlled =
    !!rowSelection &&
    Array.isArray(rowSelection.selectedRowKeys) &&
    typeof rowSelection.onChange === "function";
  const isSelectionControlled = isDirectControlled || isRowSelectionControlled;
  const effectiveSelected: Array<number | string> = isDirectControlled
    ? (selectedIds as Array<number | string>)
    : isRowSelectionControlled
      ? rowSelection.selectedRowKeys
      : internalSelected;

  const applySelection = (next: Array<number | string>) => {
    if (isDirectControlled) {
      onSelectChange?.(next);
    } else if (isRowSelectionControlled) {
      rowSelection.onChange(next);
    } else {
      setInternalSelected(next);
    }
  };

  const toggleSelect = (id: number | string) => {
    const next = effectiveSelected.includes(id)
      ? effectiveSelected.filter((x) => x !== id)
      : [...effectiveSelected, id];
    applySelection(next);
  };

  // 全选/取消全选（作用于当前已加载的 tracks；尊重 rowSelection.getCheckboxProps
  // 的 disabled 行，如 TTS 页未生成的任务不可选）
  const selectableIds = tracks
    .filter((t) => !rowSelection?.getCheckboxProps?.(t)?.disabled)
    .map((t) => t.id);
  const allSelected =
    selectableIds.length > 0 &&
    selectableIds.every((id) => effectiveSelected.includes(id));
  const partiallySelected =
    !allSelected && selectableIds.some((id) => effectiveSelected.includes(id));
  const toggleSelectAll = () => {
    applySelection(allSelected ? [] : [...selectableIds]);
  };

  const handlePlayTrack = (track: Track) => {
    if (onPlay) {
      onPlay(track, tracks);
      return;
    }
    if (track.id === currentTrack?.id && isPlaying) {
      pause();
      return;
    }
    setPlaylist(tracks, playlistSource);
    const shouldResume =
      (type === TrackType.AUDIOBOOK || track.type === TrackType.AUDIOBOOK) &&
      track.progress &&
      track.progress > 0;
    play(track, albumId, shouldResume ? track.progress : 0);
  };

  const handleToggleLike = async (
    e: React.MouseEvent,
    track: Track,
    actionType: "like" | "unlike",
  ) => {
    e.stopPropagation();
    try {
      await toggleLike(track.id, actionType);
      if (onRefresh) onRefresh();
    } catch (error) {
      message.error(t("common.error"));
    }
  };

  const openAddToPlaylistModal = async (e: React.MouseEvent, track: Track) => {
    e.stopPropagation();
    setSelectedTrack(track);
    setIsAddToPlaylistModalOpen(true);
    try {
      const res = await getPlaylists(mode, user?.id);
      if (res.code === 200) setPlaylists(res.data);
    } catch (error) {
      message.error(t("trackList.getPlaylistsFailed"));
    }
  };

  const handleAddToPlaylist = async (playlistId: number | string) => {
    if (!selectedTrack) return;
    try {
      const res = await addTrackToPlaylist(playlistId, selectedTrack.id);
      if (res.code === 200) {
        message.success(t("common.success"));
        setIsAddToPlaylistModalOpen(false);
      } else {
        message.error(t("common.error"));
      }
    } catch (error) {
      message.error(t("common.error"));
    }
  };

  const handleDeleteSubTrack = async (track: Track) => {
    try {
      const { data: impact } = await getDeletionImpact(track.id);
      modalApi.confirm({
        title: t("trackList.confirmDelete"),
        content: impact?.isLastTrackInAlbum
          ? `这是专辑《${impact.albumName}》的最后一个音频，删除后该专辑也将被同步删除。`
          : "删除后将无法恢复，且会同步删除本地原文件。",
        okText: t("common.delete"),
        okType: "danger",
        cancelText: t("common.cancel"),
        onOk: async () => {
          try {
            const res = await deleteTrack(track.id, impact?.isLastTrackInAlbum);
            if (res.code === 200) {
              message.success(t("common.success"));
              removeTrack(track.id);
              if (onRefresh) onRefresh();
            } else {
              message.error(t("common.error"));
            }
          } catch (error) {
            message.error(t("common.error"));
          }
        },
      });
    } catch (error) {
      message.error(t("trackList.getDeletionImpactFailed"));
    }
  };

  const isAudiobook =
    type === TrackType.AUDIOBOOK || tracks.some((t) => t.type === TrackType.AUDIOBOOK);

  const showSelect = isSelectionControlled || !!rowSelection;

  // 列模板（按 props 决定列宽）
  const gridTemplate = useMemo(
    () =>
      buildGridTemplate({
        showIndex,
        showCover,
        showSelect,
        showArtist,
        showAlbum,
        showSource,
        isAudiobook,
        showDuration,
        showActions,
      }),
    [
      showIndex,
      showCover,
      showSelect,
      showArtist,
      showAlbum,
      showSource,
      isAudiobook,
      showDuration,
      showActions,
    ],
  );

  // 虚拟列表
  const virtualizer = useVirtualizer({
    count: tracks.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
  });

  // 当前播放曲目变更时，滚到对应行
  useEffect(() => {
    if (!currentTrack) return;
    const idx = tracks.findIndex((t) => t.id === currentTrack.id);
    if (idx >= 0) {
      virtualizer.scrollToIndex(idx, { align: "auto" });
    }
    // 仅当 currentTrack.id 变化时触发
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTrack?.id]);

  const renderCell = (track: Track, idx: number) => {
    const liked = (track as any).likedByUsers?.some(
      (like: any) => like.userId === user?.id,
    );
    const isCurrent = currentTrack?.id === track.id;
    return (
      <>
        {showSelect && (
          <div
            className={styles.cellCheckbox}
            onClick={(e) => {
              e.stopPropagation();
              toggleSelect(track.id);
            }}
          >
            <Checkbox checked={effectiveSelected.includes(track.id)} />
          </div>
        )}
        {showIndex && (
          <div className={styles.cellIndex}>
            <Text type="secondary">{idx + 1}</Text>
          </div>
        )}
        {showCover && (
          <div
            className={styles.cellCover}
            onClick={(e) => {
              e.stopPropagation();
              handlePlayTrack(track);
            }}
          >
            <LazyImage
              src={resolveArtworkUri(track, { width: 60, format: "webp" })}
              alt={track.name}
              width={COVER_WIDTH}
              height={COVER_HEIGHT}
              style={{ borderRadius: 4, objectFit: "cover" }}
            />
            {isCurrent && isPlaying && (
              <div className={styles.playIconStatus}>
                <PlayingIndicator />
              </div>
            )}
            {isCurrent && isPlaying ? (
              <PauseCircleFilled className={styles.listPlayIcon} />
            ) : (
              <PlayCircleFilled className={styles.listPlayIcon} />
            )}
          </div>
        )}
        <div className={styles.cellTitle}>
          <Text
            type={
              isAudiobook && Number(track.progress) > 0 ? "secondary" : undefined
            }
            strong={isCurrent}
          >
            {track.name}
          </Text>
        </div>
        {showArtist && (
          <div className={styles.cellArtist}>
            <Text type="secondary">{track.artist}</Text>
          </div>
        )}
        {showAlbum && (
          <div className={styles.cellAlbum}>
            <Text type="secondary">
              {typeof track.album === "object"
                ? (track.album as any)?.name
                : (track.album as any)}
            </Text>
          </div>
        )}
        {showSource && (
          <div className={styles.cellSource}>
            <Text type="secondary">
              {track.source === TrackSource.WEBDAV
                ? t("trackList.sourceWebdav")
                : t("trackList.sourceFile")}
            </Text>
          </div>
        )}
        {isAudiobook && (
          <div className={styles.cellProgress}>
            <Text type="secondary" style={{ fontSize: 10 }}>
              {track.progress && track.duration && track.duration > 0
                ? `${Math.round((track.progress / track.duration) * 100)}%`
                : "-"}
            </Text>
          </div>
        )}
        {showDuration && (
          <div className={styles.cellDuration}>
            <Text type="secondary">{formatDuration(track.duration ?? 0)}</Text>
          </div>
        )}
        {showActions && (
          <div className={styles.cellActions} onClick={(e) => e.stopPropagation()}>
            <Dropdown
              menu={{
                items: [
                  {
                    key: "play",
                    label: t("player.play"),
                    icon: <PlayCircleOutlined />,
                    onClick: () => handlePlayTrack(track),
                  },
                  {
                    key: "like",
                    label: liked ? t("player.unlike") : t("player.like"),
                    icon: liked ? (
                      <HeartFilled style={{ color: "#ff4d4f" }} />
                    ) : (
                      <HeartOutlined />
                    ),
                    onClick: () =>
                      handleToggleLike(
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        {} as any,
                        track,
                        liked ? "unlike" : "like",
                      ),
                  },
                  {
                    key: "add",
                    label: t("player.addToPlaylist"),
                    icon: <PlusOutlined />,
                    onClick: () =>
                      openAddToPlaylistModal(
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        {} as any,
                        track,
                      ),
                  },
                  {
                    key: "download",
                    label: t("common.download"),
                    icon: <CloudDownloadOutlined />,
                    onClick: () => {
                      message.info(
                        t("common.downloading", { name: track.name }),
                      );
                      downloadTrack(track).then((success) => {
                        if (success)
                          message.success(
                            t("common.downloadSuccess", { name: track.name }),
                          );
                        else
                          message.error(
                            t("common.downloadFailed", { name: track.name }),
                          );
                      });
                    },
                  },
                  {
                    key: "delete",
                    label: t("common.delete"),
                    icon: <DeleteOutlined />,
                    danger: true,
                    onClick: () => handleDeleteSubTrack(track),
                  },
                ] as MenuProps["items"],
              }}
              trigger={["click"]}
              // 防止 dropdown 被虚拟列表容器裁剪
              getPopupContainer={() => parentRef.current || document.body}
            >
              <MoreOutlined
                style={{ cursor: "pointer", fontSize: 20 }}
              />
            </Dropdown>
          </div>
        )}
      </>
    );
  };

  return (
    <div className={styles.trackListContainer}>
      {contextHolder}
      <div
        ref={parentRef}
        className={styles.virtualViewport}
        style={{ minHeight: ROW_HEIGHT }}
      >
        {/* 表头（不参与虚拟化） */}
        <div
          className={styles.headerRow}
          style={{ gridTemplateColumns: gridTemplate, height: ROW_HEIGHT }}
        >
          {showSelect && (
            <div className={styles.headerCell}>
              <Checkbox
                checked={allSelected}
                indeterminate={partiallySelected}
                onChange={toggleSelectAll}
                title={
                  allSelected ? t("common.deselectAll") : t("common.selectAll")
                }
              />
            </div>
          )}
          {showIndex && <div className={styles.headerCell}>#</div>}
          {showCover && (
            <div className={styles.headerCell}>{t("trackList.cover")}</div>
          )}
          <div className={styles.headerCell}>{t("trackList.title")}</div>
          {showArtist && (
            <div className={styles.headerCell}>{t("trackList.artist")}</div>
          )}
          {showAlbum && (
            <div className={styles.headerCell}>{t("trackList.album")}</div>
          )}
          {showSource && (
            <div className={styles.headerCell}>{t("trackList.source")}</div>
          )}
          {isAudiobook && (
            <div className={styles.headerCell}>{t("trackList.progress")}</div>
          )}
          {showDuration && (
            <div className={styles.headerCell}>{t("trackList.duration")}</div>
          )}
          {showActions && (
            <div className={styles.headerCell}>
              <MoreOutlined />
            </div>
          )}
        </div>

        {/* 虚拟滚动容器 */}
        <div
          className={styles.virtualInner}
          style={{ height: virtualizer.getTotalSize() }}
        >
          {virtualizer.getVirtualItems().map((vItem) => {
            const track = tracks[vItem.index];
            if (!track) return null;
            return (
              <div
                key={vItem.key}
                data-index={vItem.index}
                ref={virtualizer.measureElement}
                className={`${styles.row} ${
                  currentTrack?.id === track.id ? styles.rowActive : ""
                } ${effectiveSelected.includes(track.id) ? styles.rowSelected : ""}`}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  right: 0,
                  transform: `translateY(${vItem.start}px)`,
                  height: ROW_HEIGHT,
                  gridTemplateColumns: gridTemplate,
                  cursor: "pointer",
                }}
                id={`track-${track.id}`}
                onClick={() => handlePlayTrack(track)}
              >
                {renderCell(track, vItem.index)}
              </div>
            );
          })}
        </div>

        {loading && (
          <div className={styles.loadingOverlay}>{t("common.loading")}</div>
        )}

        {tracks.length === 0 && !loading && (
          <div className={styles.emptyHint}>{t("trackList.empty")}</div>
        )}
      </div>

      <Modal
        title={t("addToPlaylistModal.title")}
        open={isAddToPlaylistModalOpen}
        onCancel={() => setIsAddToPlaylistModalOpen(false)}
        footer={null}
      >
        <div className={styles.playlistList}>
          {playlists.map((p) => (
            <div
              key={p.id}
              onClick={() => handleAddToPlaylist(p.id)}
              className={styles.playlistItem}
            >
              <Text>{p.name}</Text>
              <Text type="secondary">
                {p._count?.tracks || 0} {t("trackList.tracks")}
              </Text>
            </div>
          ))}
        </div>
      </Modal>
    </div>
  );
};

export default TrackList;
