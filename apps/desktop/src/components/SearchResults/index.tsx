import { HeartFilled, HeartOutlined, PlusOutlined } from "@ant-design/icons";
import type {
  Playlist,
  SearchResults as SearchResultsType,
} from "@soundx/services";
import {
  addTrackToPlaylist,
  getPlaylists,
  toggleTrackLike,
  toggleTrackUnLike,
} from "@soundx/services";
import { Avatar, Empty, List, message, Modal, theme } from "antd";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { useTheme } from "../../context/ThemeContext";
import LazyImage from "../LazyImage";
import { useAuthStore } from "../../store/auth";
import { usePlayerStore } from "../../store/player";
import { getCoverUrl } from "../../utils";
import { usePlayMode } from "../../utils/playMode";
import styles from "./index.module.less";

interface SearchResultsProps {
  results: SearchResultsType | null;
  onClose: () => void;
  history?: string[];
  hotSearches?: { keyword: string; count: number }[];
  onSelectKeyword?: (keyword: string) => void;
  onClearHistory?: () => void;
}

const SearchResults: React.FC<SearchResultsProps> = ({
  results,
  onClose,
  history = [],
  hotSearches = [],
  onSelectKeyword,
  onClearHistory,
}) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { play, setPlaylist } = usePlayerStore();
  const { user } = useAuthStore();
  const { mode } = usePlayMode();
  const { token } = theme.useToken();
  const { themeSetting } = useTheme();

  // Add to Playlist State
  const [isPlaylistModalOpen, setIsPlaylistModalOpen] = useState(false);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [selectedTrackId, setSelectedTrackId] = useState<
    number | string | null
  >(null);

  const handleTrackClick = (track: any) => {
    play(track);
    setPlaylist([track]);
    onClose();
  };

  const handleArtistClick = (artistId: number | string) => {
    navigate(`/artist/${artistId}`);
    onClose();
  };

  const handleAlbumClick = (albumId: number | string) => {
    navigate(`/detail?id=${albumId}`);
    onClose();
  };

  const openPlaylistModal = async (
    e: React.MouseEvent,
    trackId: number | string,
  ) => {
    e.stopPropagation();
    setSelectedTrackId(trackId);
    try {
      const res = await getPlaylists(mode, user?.id);
      if (res.code === 200) {
        setPlaylists(res.data);
        setIsPlaylistModalOpen(true);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleAddToPlaylist = async (playlistId: number | string) => {
    if (!selectedTrackId) return;
    try {
      const res = await addTrackToPlaylist(playlistId, selectedTrackId);
      if (res.code === 200) {
        message.success(t('searchResults.addSuccess'));
        setIsPlaylistModalOpen(false);
      }
    } catch (e) {
      message.error(t('searchResults.addFailed'));
    }
  };

  // Generic Item Component to handle hover actions
  const Item = ({
    data,
    type,
    onClick,
    cover,
    title,
    subtitle,
    isArtist = false,
  }: any) => {
    const isLiked = data.likedByUsers?.some((l: any) => l.userId === user?.id);
    const [liked, setLiked] = useState(isLiked);

    const handleLike = async (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!user) return;
      const newLiked = !liked;
      setLiked(newLiked);
      try {
        await (newLiked
          ? toggleTrackLike(data.id, user.id)
          : toggleTrackUnLike(data.id, user.id));
      } catch (e) {
        setLiked(!newLiked); // Revert
      }
    };

    return (
      <div className={styles.resultItem} onClick={onClick}>
        {isArtist ? (
          <Avatar
            src={cover}
            size={48}
            className={styles.avatar}
            icon={!data.avatar && data.name[0]}
          />
        ) : (
          <LazyImage
            src={cover}
            alt={title}
            width={48}
            height={48}
            className={styles.cover}
          />
        )}

        <div className={styles.info}>
          <div className={styles.name}>{title}</div>
          <div className={styles.meta}>{subtitle}</div>
        </div>

        <div className={styles.actions}>
          {type === "track" && (
            <>
              <div className={styles.actionBtn} onClick={handleLike}>
                {liked ? (
                  <HeartFilled style={{ color: token.colorError }} />
                ) : (
                  <HeartOutlined />
                )}
              </div>
              <div
                className={styles.actionBtn}
                onClick={(e) => openPlaylistModal(e, data.id)}
              >
                <PlusOutlined />
              </div>
            </>
          )}
          {/* For now only Tracks support explicit actions in search dropdown for simplicity and UI space */}
        </div>
      </div>
    );
  };

  const hasResults =
    results &&
    (results.tracks.length > 0 ||
      results.artists.length > 0 ||
      results.albums.length > 0);

  if (!hasResults) {
    return (
      <div
        className={styles.searchResults}
        style={{
          backgroundColor:
            themeSetting === "dark"
              ? "rgba(0, 0, 0, 0.9)"
              : "rgba(255, 255, 255, 0.9)",
        }}
      >
        {history.length > 0 && (
          <div className={styles.section}>
            <div className={styles.sectionHeader}>
              <div className={styles.sectionTitle}>{t('searchResults.searchHistory')}</div>
              <div className={styles.clearBtn} onClick={onClearHistory}>
                {t('searchResults.clearHistory')}
              </div>
            </div>
            <div className={styles.tagGroup}>
              {history.map((kw, i) => (
                <div
                  key={i}
                  className={styles.tag}
                  onClick={() => onSelectKeyword?.(kw)}
                >
                  {kw}
                </div>
              ))}
            </div>
          </div>
        )}

        {hotSearches.length > 0 && (
          <div className={styles.section}>
            <div className={styles.sectionTitle}>{t('searchResults.hotSearch')}</div>
            <div className={styles.hotList}>
              {hotSearches.map((item, i) => (
                <div
                  key={i}
                  className={styles.hotItem}
                  onClick={() => onSelectKeyword?.(item.keyword)}
                >
                  <span
                    className={`${styles.rank} ${i < 3 ? styles.topRank : ""}`}
                  >
                    {i + 1}
                  </span>
                  <span className={styles.hotKeyword}>{item.keyword}</span>
                  {i < 3 && (
                    <span
                      className={styles.hotTag}
                      style={{
                        color: token.colorBgBase,
                        backgroundColor: token.colorPrimary,
                      }}
                    >
                      HOT
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {!history.length && !hotSearches.length && (
          <div className={styles.empty}>
            <Empty description={t('searchResults.noResults')} />
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className={styles.searchResults}
      style={{
        backgroundColor:
          themeSetting === "dark"
            ? "rgba(0, 0, 0, 0.9)"
            : "rgba(255, 255, 255, 0.9)",
      }}
    >
      {results.tracks.length > 0 && (
        <div className={styles.section}>
          <div className={styles.sectionTitle}>{t('searchResults.single')}</div>
          {results.tracks.map((track) => (
            <Item
              key={track.id}
              data={track}
              type="track"
              onClick={() => handleTrackClick(track)}
              cover={getCoverUrl(track.cover, track.id, 96)}
              title={track.name}
              subtitle={`${track.artist} · ${track.album}`}
            />
          ))}
        </div>
      )}

      {results.artists.length > 0 && (
        <div className={styles.section}>
          <div className={styles.sectionTitle}>{t('searchResults.artist')}</div>
          {results.artists.map((artist) => (
            <Item
              key={artist.id}
              data={artist}
              type="artist"
              onClick={() => handleArtistClick(artist.id)}
              cover={getCoverUrl(artist, artist.id, 96)}
              title={artist.name}
              subtitle={artist.type === "MUSIC" ? t('searchResults.musician') : t('searchResults.voiceActor')}
              isArtist={true}
            />
          ))}
        </div>
      )}

      {results.albums.length > 0 && (
        <div className={styles.section}>
          <div className={styles.sectionTitle}>{t('searchResults.album')}</div>
          {results.albums.map((album) => (
            <Item
              key={album.id}
              data={album}
              type="album"
              onClick={() => handleAlbumClick(album.id)}
              cover={getCoverUrl(album, album.id, 96)}
              title={album.name}
              subtitle={`${album.artist} · ${album.year}`}
            />
          ))}
        </div>
      )}

      <Modal
        title={t('addToPlaylistModal.title')}
        open={isPlaylistModalOpen}
        onCancel={() => setIsPlaylistModalOpen(false)}
        footer={null}
      >
        <List
          dataSource={playlists}
          renderItem={(item) => (
            <List.Item
              onClick={() => handleAddToPlaylist(item.id)}
              style={{ cursor: "pointer" }}
            >
              <List.Item.Meta
                title={item.name}
                description={`${item._count?.tracks || 0} 首`}
              />
            </List.Item>
          )}
        />
      </Modal>
    </div>
  );
};

export default SearchResults;
