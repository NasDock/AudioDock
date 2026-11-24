import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  DeleteOutlined,
  EditOutlined,
  MoreOutlined,
  PictureOutlined,
  UnorderedListOutlined,
} from "@ant-design/icons";
import {
  deleteCollection,
  getCollectionById,
  removeAlbumFromCollection,
  reorderCollection,
  updateCollection,
  uploadCollectionCover,
  TrackingEvent as TE,
  TrackingFeature as TF,
} from "@soundx/services";
import {
  Button,
  Col,
  Dropdown,
  Input,
  message,
  Modal,
  Popconfirm,
  Row,
  theme,
  Typography,
} from "antd";
import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import Cover from "../../components/Cover";
import type { Album } from "../../models";
import { trackEvent } from "../../services/tracking";
import { resolveArtworkUri } from "../../services/trackResolver";
import styles from "./index.module.less";

const CollectionDetail: React.FC = () => {
  const { t } = useTranslation();
  const { id } = useParams();
  const navigate = useNavigate();
  const { token } = theme.useToken();
  const [modal, contextHolder] = Modal.useModal();
  const [collection, setCollection] = useState<any>(null);
  const [albums, setAlbums] = useState<Album[]>([]);
  const [renameOpen, setRenameOpen] = useState(false);
  const [coverOpen, setCoverOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [uploadingCover, setUploadingCover] = useState(false);
  const openReportedRef = useRef(false);

  useEffect(() => {
    if (!openReportedRef.current) {
      openReportedRef.current = true;
      trackEvent({
        feature: TF.CONTENT,
        eventName: TE.CONTENT_COLLECTION_OPEN,
        metadata: { collectionId: id },
      });
    }
    if (id) loadDetail(id);
  }, [id]);

  const loadDetail = async (collectionId: string) => {
    const res = await getCollectionById(collectionId);
    if (res.code === 200) {
      setCollection(res.data);
      const items = res.data.items || [];
      setAlbums(items.map((item: any) => item.album).filter(Boolean));
    }
  };

  const handleRename = async () => {
    if (!collection) return;
    const name = nameInput.trim();
    if (!name) return;
    const res = await updateCollection(collection.id, { name });
    if (res.code === 200) {
      setCollection(res.data);
      setRenameOpen(false);
    }
  };

  const handleSelectCover = async (album: Album) => {
    if (!collection) return;
    const res = await updateCollection(collection.id, { cover: album.cover });
    if (res.code === 200) {
      setCollection(res.data);
      setCoverOpen(false);
    }
  };

  const handleCoverUpload = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    if (!collection) return;
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      setUploadingCover(true);
      const res = await uploadCollectionCover(collection.id, file);
      if (res.code === 200) {
        setCollection(res.data);
        message.success(t("collectionDetail.coverUpdated"));
        setCoverOpen(false);
      } else {
        message.error(res.message || t("collectionDetail.coverUploadFailed"));
      }
    } catch (error) {
      message.error(t("collectionDetail.coverUploadFailed"));
    } finally {
      setUploadingCover(false);
    }
  };

  const moveAlbum = async (index: number, direction: -1 | 1) => {
    const next = [...albums];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    const [item] = next.splice(index, 1);
    next.splice(target, 0, item);
    setAlbums(next);
    if (collection) {
      await reorderCollection(
        collection.id,
        next.map((a) => a.id),
      );
    }
  };

  const handleRemoveAlbum = async (album: Album) => {
    if (!collection) return;
    try {
      const res = await removeAlbumFromCollection(collection.id, album.id);
      if (res.code === 200) {
        setAlbums((prev) => prev.filter((item) => item.id !== album.id));
        message.success(t("collectionDetail.removed"));
      } else {
        message.error(
          res.message ||
            t("collectionDetail.removeFailed", { defaultValue: "移除失败" }),
        );
      }
    } catch (error) {
      message.error(
        t("collectionDetail.removeFailed", { defaultValue: "移除失败" }),
      );
    }
  };

  const handleDeleteCollection = async () => {
    if (!collection) return;
    try {
      const res = await deleteCollection(collection.id);
      if (res.code === 200) {
        message.success(
          t("collectionDetail.collectionDisbanded", {
            defaultValue: "合集已解散",
          }),
        );
        navigate("/collections");
      } else {
        message.error(
          res.message ||
            t("collectionDetail.disbandFailed", {
              defaultValue: "删除合集失败",
            }),
        );
      }
    } catch (error) {
      message.error(
        t("collectionDetail.disbandFailed", { defaultValue: "删除合集失败" }),
      );
    }
  };

  if (!collection) {
    return (
      <div className={styles.empty} style={{ color: token.colorTextSecondary }}>
        合集不存在
      </div>
    );
  }

  const cover = collection.cover || albums[0]?.cover;
  const getAlbumCoverSrc = (album: Album) =>
    resolveArtworkUri(album, { width: 300 }) ||
    `https://picsum.photos/seed/${album.id}/300/300`;

  const menuItems = [
    {
      key: "rename",
      label: t("collectionDetail.rename"),
      icon: <EditOutlined />,
      onClick: () => {
        setNameInput(collection.name);
        setRenameOpen(true);
      },
    },
    {
      key: "cover",
      label: t("collectionDetail.selectCover"),
      icon: <PictureOutlined />,
      onClick: () => setCoverOpen(true),
    },
    {
      key: "manage",
      label: t("collectionDetail.manageAlbums"),
      icon: <UnorderedListOutlined />,
      onClick: () => setManageOpen(true),
    },
    {
      key: "delete",
      label: t("collectionDetail.disbandCollection"),
      icon: <DeleteOutlined />,
      onClick: () =>
        modal.confirm({
          title: t("collectionDetail.confirmDisband"),
          content: t("collectionDetail.disbandWarning"),
          okText: t("collectionDetail.disband"),
          cancelText: t("common.cancel"),
          okButtonProps: { danger: true },
          onOk: handleDeleteCollection,
        }),
      danger: true,
    },
  ];

  return (
    <div className={styles.container}>
      {contextHolder}
      <div className={styles.header}>
        <div className={styles.coverWrap}>
          <img className={styles.cover} src={resolveArtworkUri(cover, { width: 600 })} />
          <Dropdown menu={{ items: menuItems }} trigger={["click"]}>
            <button className={styles.moreBtn}>
              <MoreOutlined />
            </button>
          </Dropdown>
        </div>
        <div>
          <Typography.Title level={2} className={styles.title}>
            {collection.name}
          </Typography.Title>
          <div
            className={styles.subtitle}
            style={{ color: token.colorTextSecondary }}
          >
            {t("collectionDetail.albumCount", { count: albums.length })}
          </div>
        </div>
      </div>

      <div className={styles.content}>
        <Typography.Title level={4} className={styles.sectionTitle}>
          {t("collectionDetail.albums", { count: albums.length })}
        </Typography.Title>
        <Row gutter={[24, 24]}>
          {albums.map((album) => (
            <Col key={album.id}>
              <div className={styles.card}>
                <Cover item={album} />
              </div>
            </Col>
          ))}
        </Row>
      </div>

      <Modal
        title={t("collectionDetail.rename")}
        open={renameOpen}
        onOk={handleRename}
        onCancel={() => setRenameOpen(false)}
      >
        <Input
          value={nameInput}
          onChange={(e) => setNameInput(e.target.value)}
        />
      </Modal>

      <Modal
        title={t("collectionDetail.selectCover")}
        open={coverOpen}
        onCancel={() => setCoverOpen(false)}
        footer={null}
      >
        <div className={styles.coverList}>
          {albums.map((album) => (
            <div
              key={album.id}
              className={styles.coverOption}
              onClick={() => handleSelectCover(album)}
            >
              <img
                className={styles.coverThumb}
                src={getAlbumCoverSrc(album)}
              />
              <div>{album.name}</div>
            </div>
          ))}
        </div>
        <div className={styles.coverUpload}>
          <input
            id="collection-cover-upload"
            type="file"
            accept="image/*"
            style={{ display: "none" }}
            onChange={handleCoverUpload}
          />
          <Button
            block
            loading={uploadingCover}
            onClick={() =>
              document.getElementById("collection-cover-upload")?.click()
            }
          >
            {t("collectionDetail.uploadImageAsCover")}
          </Button>
        </div>
      </Modal>

      <Modal
        title={t("collectionDetail.manageAlbums")}
        open={manageOpen}
        onCancel={() => setManageOpen(false)}
        footer={null}
      >
        <div className={styles.manageList}>
          {albums.map((album, index) => (
            <div key={album.id} className={styles.manageRow}>
              <img
                className={styles.manageCover}
                src={getAlbumCoverSrc(album)}
              />
              <div className={styles.manageInfo}>
                <div className={styles.manageTitle}>{album.name}</div>
                <div
                  className={styles.manageSub}
                  style={{ color: token.colorTextSecondary }}
                >
                  {album.artist}
                </div>
              </div>
              <div className={styles.manageActions}>
                <Button
                  size="small"
                  icon={<ArrowUpOutlined />}
                  onClick={() => moveAlbum(index, -1)}
                />
                <Button
                  size="small"
                  icon={<ArrowDownOutlined />}
                  onClick={() => moveAlbum(index, 1)}
                />
                <Popconfirm
                  title={t("collectionDetail.confirmRemoveAlbum")}
                  okText={t("collectionDetail.remove")}
                  cancelText={t("common.cancel")}
                  placement="topRight"
                  onConfirm={() => handleRemoveAlbum(album)}
                >
                  <Button size="small" danger icon={<DeleteOutlined />} />
                </Popconfirm>
              </div>
            </div>
          ))}
        </div>
      </Modal>
    </div>
  );
};

export default CollectionDetail;
