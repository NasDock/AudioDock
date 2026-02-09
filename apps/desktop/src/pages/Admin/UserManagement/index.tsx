import { LeftOutlined, PlusOutlined } from "@ant-design/icons";
import {
    createAdminUser,
    deleteAdminUser,
    getAdminUsers,
    setAdminUserExpiration,
    type User,
} from "@soundx/services";
import {
    Button,
    Checkbox,
    Flex,
    Form,
    Input,
    message,
    Modal,
    Space,
    Table,
    Tag,
    Typography,
} from "antd";
import dayjs from "dayjs";
import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import styles from "./index.module.less";

const { Title } = Typography;

const UserManagement: React.FC = () => {
  const navigate = useNavigate();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(false);
  const [expirationModalVisible, setExpirationModalVisible] = useState(false);

  const [createModalVisible, setCreateModalVisible] = useState(false);

  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [expirationDays, setExpirationDays] = useState<number | null>(null);
  const [modal, contextHolder] = Modal.useModal();
  const [messageApi, messageContextHolder] = message.useMessage();
  const [form] = Form.useForm();

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const res = await getAdminUsers();
      if (res.code === 200) {
        setUsers(res.data);
      } else {
        message.error(res.message);
      }
    } catch (error) {
      message.error("获取用户列表失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const handleDeleteUser = async (id: number) => {
    modal.confirm({
      title: "确认删除用户",
      content: "删除后无法恢复，确定要删除吗？",
      onOk: async () => {
        const res = await deleteAdminUser(id);
        if (res.code === 200) {
          messageApi.success("删除成功");
          fetchUsers();
        } else {
          messageApi.error(res.message);
        }
      },
    });
  };

  const handleSetExpiration = async () => {
    // ... existing handleSetExpiration ...
    if (selectedUserId === null) return;
    const res = await setAdminUserExpiration(selectedUserId, expirationDays);
    if (res.code === 200) {
      messageApi.success("设置成功");
      setExpirationModalVisible(false);
      fetchUsers();
    } else {
      messageApi.error(res.message);
    }
  };

  const handleCreateUser = async () => {
    try {
      const values = await form.validateFields();
      const res = await createAdminUser(values);
      if (res.code === 200) {
        messageApi.success("创建成功");
        setCreateModalVisible(false);
        form.resetFields();
        fetchUsers();
      } else {
        messageApi.error(res.message);
      }
    } catch (error) {
      // form validation failed
    }
  };

  const columns = [
    // ... existing columns ...
    {
      title: "ID",
      dataIndex: "id",
      key: "id",
      width: 60,
    },
    {
      title: "用户名",
      dataIndex: "username",
      key: "username",
    },
    {
      title: "管理员",
      dataIndex: "is_admin",
      key: "is_admin",
      render: (val: boolean) =>
        val ? <Tag color="gold">管理员</Tag> : <Tag>普通用户</Tag>,
    },
    {
      title: "注册时间",
      dataIndex: "createdAt",
      key: "createdAt",
      render: (val: string) =>
        val ? dayjs(val).format("YYYY-MM-DD HH:mm") : "-",
    },
    {
      title: "过期时间",
      dataIndex: "expiresAt",
      key: "expiresAt",
      render: (val: string) => {
        if (!val) return <Tag color="green">永久有效</Tag>;
        const date = dayjs(val);
        const isExpired = date.isBefore(dayjs());
        return (
          <Tag color={isExpired ? "red" : "blue"}>
            {date.format("YYYY-MM-DD")}
          </Tag>
        );
      },
    },
    {
      title: "操作",
      key: "action",
      render: (_: any, record: User) => (
        <Space>
          {!record.is_admin && (
            <>
              <Button
                size="small"
                onClick={() => {
                  setSelectedUserId(record.id as number);
                  setExpirationDays(null); // default to unset? or keep user input?
                  setExpirationModalVisible(true);
                }}
              >
                设置有效期
              </Button>
              <Button
                size="small"
                danger
                onClick={() => handleDeleteUser(record.id as number)}
              >
                删除
              </Button>
            </>
          )}
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
            返回
          </Button>
          <Title level={4} style={{ margin: 0 }}>
            用户管理
          </Title>
        </Space>
        <div style={{ marginTop: 16 }}>
          <Space style={{ marginBottom: 16 }}>
            <Button onClick={fetchUsers}>刷新列表</Button>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => setCreateModalVisible(true)}
            >
              创建用户
            </Button>
          </Space>
        </div>
      </Flex>

      <Table
        columns={columns}
        dataSource={users}
        rowKey="id"
        loading={loading}
        pagination={{ pageSize: 10 }}
      />

      {contextHolder}
      {messageContextHolder}

      <Modal
        title="创建新用户"
        open={createModalVisible}
        onOk={handleCreateUser}
        onCancel={() => setCreateModalVisible(false)}
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="username"
            label="用户名"
            rules={[{ required: true, message: "请输入用户名" }]}
          >
            <Input placeholder="请输入用户名" />
          </Form.Item>
          <Form.Item
            name="password"
            label="密码"
            rules={[{ required: true, message: "请输入密码" }]}
          >
            <Input.Password placeholder="请输入密码" />
          </Form.Item>
          <Form.Item name="is_admin" valuePropName="checked">
            <Checkbox>设为管理员</Checkbox>
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="设置过期时间"
        open={expirationModalVisible}
        onOk={handleSetExpiration}
        onCancel={() => setExpirationModalVisible(false)}
      >
        <div style={{ padding: "20px 0" }}>
          <p>
            设置多少天后过期（空值或0表示手动指定日期，此处仅支持快捷设置天数，置空则取消过期时间）
          </p>
          <Space direction="vertical" style={{ width: "100%" }}>
            <Space>
              <Button
                type={expirationDays === 7 ? "primary" : "default"}
                onClick={() => setExpirationDays(7)}
              >
                7天
              </Button>
              <Button
                type={expirationDays === 30 ? "primary" : "default"}
                onClick={() => setExpirationDays(30)}
              >
                30天
              </Button>
              <Button
                type={expirationDays === 365 ? "primary" : "default"}
                onClick={() => setExpirationDays(365)}
              >
                一年
              </Button>
              <Button
                type={expirationDays === null ? "primary" : "default"}
                onClick={() => setExpirationDays(null)}
              >
                永久有效
              </Button>
            </Space>
          </Space>
        </div>
      </Modal>
    </div>
  );
};

export default UserManagement;
