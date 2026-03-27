import {
  getCollectionById,
  reorderCollection,
  removeAlbumFromCollection,
  uploadCollectionCover,
  updateCollection,
} from "@soundx/services";
import type { Album } from "../../models";
import { useParams } from "react-router-dom";
import React, { useEffect, useState } from "react";
import {
  Button,
  Dropdown,
  Input,
  Modal,
  Popconfirm,
  Row,
  Col,
  theme,
  Typography,
  message,
} from "antd";
import {
  MoreOutlined,
  ArrowUpOutlined,
  ArrowDownOutlined,
  EditOutlined,
  PictureOutlined,
  DeleteOutlined,
  UnorderedListOutlined,
} from "@ant-design/icons";
import { resolveArtworkUri } from "../../services/trackResolver";
import Cover from "../../components/Cover";
import styles from "./index.module.less";

const CollectionDetail: React.FC = () => {
  const { id } = useParams();
  const { token } = theme.useToken();
  const [collection, setCollection] = useState<any>(null);
  const [albums, setAlbums] = useState<Album[]>([]);
  const [renameOpen, setRenameOpen] = useState(false);
  const [coverOpen, setCoverOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [uploadingCover, setUploadingCover] = useState(false);

  useEffect(() => {
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

  const handleCoverUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    if (!collection) return;
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      setUploadingCover(true);
      const res = await uploadCollectionCover(collection.id, file);
      if (res.code === 200) {
        setCollection(res.data);
        message.success("封面已更新");
        setCoverOpen(false);
      } else {
        message.error(res.message || "封面上传失败");
      }
    } catch (error) {
      message.error("封面上传失败");
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
      await reorderCollection(collection.id, next.map((a) => a.id));
    }
  };

  const handleRemoveAlbum = async (album: Album) => {
    if (!collection) return;
    try {
      const res = await removeAlbumFromCollection(collection.id, album.id);
      if (res.code === 200) {
        setAlbums((prev) => prev.filter((item) => item.id !== album.id));
        message.success("已移除");
      } else {
        message.error(res.message || "移除失败");
      }
    } catch (error) {
      message.error("移除失败");
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
    resolveArtworkUri(album) || `https://picsum.photos/seed/${album.id}/300/300`;

  const menuItems = [
    {
      key: "rename",
      label: "修改名称",
      icon: <EditOutlined />,
      onClick: () => {
        setNameInput(collection.name);
        setRenameOpen(true);
      },
    },
    {
      key: "cover",
      label: "选定封面",
      icon: <PictureOutlined />,
      onClick: () => setCoverOpen(true),
    },
    {
      key: "manage",
      label: "管理专辑",
      icon: <UnorderedListOutlined />,
      onClick: () => setManageOpen(true),
    },
  ];

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.coverWrap}>
          <img className={styles.cover} src={resolveArtworkUri(cover)} />
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
          <div className={styles.subtitle} style={{ color: token.colorTextSecondary }}>
            {albums.length} 张专辑
          </div>
        </div>
      </div>

      <div className={styles.content}>
        <Typography.Title level={4} className={styles.sectionTitle}>
          专辑 ({albums.length})
        </Typography.Title>
        <Row gutter={[24, 24]}>
          {albums.map((album, index) => (
            <Col key={album.id}>
              <div className={styles.card}>
                <Cover item={album} />
              </div>
            </Col>
          ))}
        </Row>
      </div>

      <Modal
        title="修改名称"
        open={renameOpen}
        onOk={handleRename}
        onCancel={() => setRenameOpen(false)}
      >
        <Input value={nameInput} onChange={(e) => setNameInput(e.target.value)} />
      </Modal>

      <Modal
        title="选定封面"
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
              <img className={styles.coverThumb} src={getAlbumCoverSrc(album)} />
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
            上传图片设置封面
          </Button>
        </div>
      </Modal>

      <Modal
        title="管理专辑"
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
                  title="确认移除该专辑？"
                  okText="移除"
                  cancelText="取消"
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
