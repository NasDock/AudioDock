import { CopyOutlined, LeftOutlined, PlusOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import {
    createAccessToken,
    deleteAccessToken,
    getAccessTokens,
    updateAccessToken,
    type AccessToken,
} from "@soundx/services";
import {
    Button,
    Flex,
    Form,
    Input,
    message,
    Modal,
    Space,
    Switch,
    Table,
    Tag,
    Typography,
} from "antd";
import dayjs from "dayjs";
import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import styles from "./index.module.less";

const { Title, Text, Paragraph } = Typography;

const AccessTokenManagement: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [tokens, setTokens] = useState<AccessToken[]>([]);
  const [loading, setLoading] = useState(false);
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [renameModalVisible, setRenameModalVisible] = useState(false);
  /** 创建成功后展示的完整令牌（仅此一次可见） */
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const [selectedToken, setSelectedToken] = useState<AccessToken | null>(null);
  const [modal, contextHolder] = Modal.useModal();
  const [messageApi, messageContextHolder] = message.useMessage();
  const [createForm] = Form.useForm();
  const [renameForm] = Form.useForm();

  const fetchTokens = async () => {
    setLoading(true);
    try {
      const res = await getAccessTokens();
      if (res.code === 200) {
        setTokens(res.data);
      } else {
        messageApi.error(res.message);
      }
    } catch (error) {
      messageApi.error(t("accessTokenManagement.fetchFailed"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTokens();
  }, []);

  const handleCreate = async () => {
    try {
      const values = await createForm.validateFields();
      const res = await createAccessToken(values.name.trim());
      if (res.code === 200) {
        setCreateModalVisible(false);
        createForm.resetFields();
        setCreatedToken(res.data.token);
        fetchTokens();
      } else {
        messageApi.error(res.message);
      }
    } catch (error) {
      // form validation failed
    }
  };

  const handleCopyToken = async () => {
    if (!createdToken) return;
    try {
      await navigator.clipboard.writeText(createdToken);
      messageApi.success(t("accessTokenManagement.copySuccess"));
    } catch (error) {
      messageApi.error(t("accessTokenManagement.copyFailed"));
    }
  };

  const handleToggleEnabled = async (record: AccessToken, enabled: boolean) => {
    const res = await updateAccessToken(record.id, { enabled });
    if (res.code === 200) {
      messageApi.success(
        enabled
          ? t("accessTokenManagement.enableSuccess")
          : t("accessTokenManagement.disableSuccess"),
      );
      fetchTokens();
    } else {
      messageApi.error(res.message);
    }
  };

  const handleRename = async () => {
    if (!selectedToken) return;
    try {
      const values = await renameForm.validateFields();
      const res = await updateAccessToken(selectedToken.id, {
        name: values.name.trim(),
      });
      if (res.code === 200) {
        messageApi.success(t("accessTokenManagement.renameSuccess"));
        setRenameModalVisible(false);
        setSelectedToken(null);
        fetchTokens();
      } else {
        messageApi.error(res.message);
      }
    } catch (error) {
      // form validation failed
    }
  };

  const handleDelete = async (record: AccessToken) => {
    modal.confirm({
      title: t("accessTokenManagement.deleteConfirmTitle"),
      content: t("accessTokenManagement.deleteConfirmContent", {
        name: record.name,
      }),
      okText: t("common.confirm"),
      cancelText: t("common.cancel"),
      onOk: async () => {
        const res = await deleteAccessToken(record.id);
        if (res.code === 200) {
          messageApi.success(t("accessTokenManagement.deleteSuccess"));
          fetchTokens();
        } else {
          messageApi.error(res.message);
        }
      },
    });
  };

  const columns = [
    {
      title: t("accessTokenManagement.name"),
      dataIndex: "name",
      key: "name",
    },
    {
      title: t("accessTokenManagement.token"),
      dataIndex: "tokenPrefix",
      key: "tokenPrefix",
      render: (val: string) => <Text code>{val}…</Text>,
    },
    {
      title: t("accessTokenManagement.status"),
      dataIndex: "enabled",
      key: "enabled",
      render: (val: boolean, record: AccessToken) => (
        <Switch
          checked={val}
          onChange={(checked) => handleToggleEnabled(record, checked)}
        />
      ),
    },
    {
      title: t("accessTokenManagement.lastUsedAt"),
      dataIndex: "lastUsedAt",
      key: "lastUsedAt",
      render: (val: string) =>
        val ? dayjs(val).format("YYYY-MM-DD HH:mm") : <Tag>{t("accessTokenManagement.neverUsed")}</Tag>,
    },
    {
      title: t("accessTokenManagement.createdAt"),
      dataIndex: "createdAt",
      key: "createdAt",
      render: (val: string) =>
        val ? dayjs(val).format("YYYY-MM-DD HH:mm") : "-",
    },
    {
      title: t("accessTokenManagement.actions"),
      key: "action",
      render: (_: any, record: AccessToken) => (
        <Space>
          <Button
            size="small"
            onClick={() => {
              setSelectedToken(record);
              renameForm.setFieldsValue({ name: record.name });
              setRenameModalVisible(true);
            }}
          >
            {t("accessTokenManagement.rename")}
          </Button>
          <Button size="small" danger onClick={() => handleDelete(record)}>
            {t("common.delete")}
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <div
      style={{ padding: 24, height: "100%", overflow: "auto" }}
      className={styles.trackListContainer}
    >
      <Flex justify="space-between">
        <Space style={{ marginBottom: 16 }}>
          <Button
            type="text"
            icon={<LeftOutlined />}
            onClick={() => navigate(-1)}
          >
            {t("header.back")}
          </Button>
          <Title level={4} style={{ margin: 0 }}>
            {t("accessTokenManagement.title")}
          </Title>
        </Space>
        <div style={{ marginTop: 16 }}>
          <Space style={{ marginBottom: 16 }}>
            <Button onClick={fetchTokens}>{t("common.refresh")}</Button>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => setCreateModalVisible(true)}
            >
              {t("accessTokenManagement.create")}
            </Button>
          </Space>
        </div>
      </Flex>

      <Paragraph type="secondary" style={{ marginBottom: 16 }}>
        {t("accessTokenManagement.description")}
      </Paragraph>

      <Table
        columns={columns}
        dataSource={tokens}
        rowKey="id"
        loading={loading}
        pagination={{ pageSize: 10 }}
      />

      {contextHolder}
      {messageContextHolder}

      <Modal
        title={t("accessTokenManagement.createTitle")}
        open={createModalVisible}
        onOk={handleCreate}
        onCancel={() => setCreateModalVisible(false)}
        okText={t("common.confirm")}
        cancelText={t("common.cancel")}
      >
        <Form form={createForm} layout="vertical">
          <Form.Item
            name="name"
            label={t("accessTokenManagement.nameLabel")}
            rules={[
              { required: true, message: t("accessTokenManagement.nameRequired") },
            ]}
          >
            <Input placeholder={t("accessTokenManagement.namePlaceholder")} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={t("accessTokenManagement.renameTitle")}
        open={renameModalVisible}
        onOk={handleRename}
        onCancel={() => {
          setRenameModalVisible(false);
          setSelectedToken(null);
        }}
        okText={t("common.confirm")}
        cancelText={t("common.cancel")}
      >
        <Form form={renameForm} layout="vertical">
          <Form.Item
            name="name"
            label={t("accessTokenManagement.nameLabel")}
            rules={[
              { required: true, message: t("accessTokenManagement.nameRequired") },
            ]}
          >
            <Input placeholder={t("accessTokenManagement.namePlaceholder")} />
          </Form.Item>
        </Form>
      </Modal>

      {/* 创建成功：完整令牌仅此一次展示 */}
      <Modal
        title={t("accessTokenManagement.createdTitle")}
        open={!!createdToken}
        footer={
          <Button type="primary" onClick={() => setCreatedToken(null)}>
            {t("accessTokenManagement.createdDone")}
          </Button>
        }
        onCancel={() => setCreatedToken(null)}
        closable={false}
        maskClosable={false}
      >
        <Paragraph>{t("accessTokenManagement.createdHint")}</Paragraph>
        <Paragraph
          copyable={false}
          style={{
            wordBreak: "break-all",
            padding: 12,
            borderRadius: 8,
            background: "rgba(128, 128, 128, 0.15)",
          }}
        >
          <Text code style={{ fontSize: 13 }}>{createdToken}</Text>
        </Paragraph>
        <Button icon={<CopyOutlined />} onClick={handleCopyToken} block>
          {t("accessTokenManagement.copy")}
        </Button>
      </Modal>
    </div>
  );
};

export default AccessTokenManagement;
