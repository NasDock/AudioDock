import { PlusOutlined } from "@ant-design/icons";
import type { TtsTask } from "@soundx/services";
import {
    deleteTtsTask,
    getTtsTasks,
    pauseTtsTask,
    resumeTtsTask,
} from "@soundx/services";
import {
    Button,
    Flex,
    Progress,
    Segmented,
    Space,
    Table,
    Tag,
    Typography,
} from "antd";
import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { trackEvent } from "../../../services/tracking";

const { Title, Text } = Typography;

// TtsTask type is now imported from @soundx/services

const TaskList: React.FC = () => {
  const [tasks, setTasks] = useState<TtsTask[]>([]);
  const [loading, setLoading] = useState(false);
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const navigate = useNavigate();

  const fetchTasks = async (showLoading = true) => {
    if (showLoading) setLoading(true);
    try {
      const res = await getTtsTasks();
      setTasks(res.tasks);
    } catch (error) {
      console.error("Failed to fetch tasks:", error);
    } finally {
      if (showLoading) setLoading(false);
    }
  };

  const handleAction = async (action: string, id: string) => {
    try {
      if (action === "delete") {
        trackEvent({
          feature: "tts",
          eventName: "tts_task_delete",
          metadata: { taskId: id },
        });
        await deleteTtsTask(id);
      } else if (action === "pause") {
        trackEvent({
          feature: "tts",
          eventName: "tts_task_pause",
          metadata: { taskId: id },
        });
        await pauseTtsTask(id);
      } else if (action === "resume") {
        trackEvent({
          feature: "tts",
          eventName: "tts_task_resume",
          metadata: { taskId: id },
        });
        await resumeTtsTask(id);
      }
      fetchTasks(false);
    } catch (error) {
      console.error(`Failed to ${action} task:`, error);
    }
  };

  useEffect(() => {
    fetchTasks();
    const timer = setInterval(() => fetchTasks(false), 5000); // 后台静默刷新
    return () => clearInterval(timer);
  }, []);

  const filteredTasks =
    filterStatus === "all"
      ? tasks
      : tasks.filter((t) => t.status === filterStatus);

  const columns = [
    {
      title: "作品名称",
      dataIndex: "book_name",
      key: "book_name",
      width: 100,
      fixed: "left" as any,
    },
    {
      title: "作者",
      dataIndex: "author",
      key: "author",
      width: 100,
      ellipsis: true,
    },
    {
      title: "状态",
      dataIndex: "status",
      key: "status",
      width: 100,
      render: (status: string) => {
        let color = "blue";
        let text = status.toUpperCase();
        if (status === "completed") {
          color = "green";
          text = "已完成";
        }
        if (status === "failed") {
          color = "red";
          text = "失败";
        }
        if (status === "processing") {
          color = "orange";
          text = "处理中";
        }
        if (status === "paused") {
          color = "default";
          text = "已暂停";
        }
        if (status === "pending") {
          color = "cyan";
          text = "等待中";
        }
        return <Tag color={color}>{text}</Tag>;
      },
    },
    {
      title: "进度",
      key: "progress",
      width: 200,
      render: (_: any, record: TtsTask) => {
        const percent =
          Math.round(
            (record.completed_chapters / record.total_chapters) * 100,
          ) || 0;
        return (
          <div style={{ width: 150 }}>
            <Progress
              percent={percent}
              size="small"
              status={
                record.status === "failed"
                  ? "exception"
                  : record.status === "completed"
                    ? "success"
                    : "active"
              }
            />
            <div style={{ fontSize: 12, color: "#999" }}>
              {record.completed_chapters} / {record.total_chapters} 章节
            </div>
          </div>
        );
      },
    },
    {
      title: "创建时间",
      dataIndex: "created_at",
      key: "created_at",
      width: 120,
      render: (text: string) => {
        const date = new Date(text);
        return (
          <div style={{ fontSize: "12px", lineHeight: "1.4" }}>
            <div>{date.toLocaleDateString()}</div>
            <Text type="secondary" style={{ fontSize: "11px" }}>
              {date.toLocaleTimeString()}
            </Text>
          </div>
        );
      },
    },
    {
      title: "操作",
      key: "action",
      fixed: "right" as any,
      width: 120,
      render: (_: any, record: TtsTask) => (
        <Space size="small">
          {record.status === "processing" && (
            <Button
              type="link"
              size="small"
              onClick={() => handleAction("pause", record.id)}
            >
              暂停
            </Button>
          )}
          {(record.status === "paused" ||
            record.status === "failed" ||
            record.status === "pending") && (
            <Button
              type="link"
              size="small"
              onClick={() => handleAction("resume", record.id)}
            >
              {record.status === "failed" ? "重试" : "开始"}
            </Button>
          )}
          <Button
            type="link"
            size="small"
            danger
            onClick={() => handleAction("delete", record.id)}
          >
            删除
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <div
      style={{
        padding: "24px",
        height: "100%",
        width: "100%",
        overflowY: "auto",
        backgroundColor: "rgba(255, 255, 255, 0.1)",
        backdropFilter: "blur(100px)",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-end",
          marginBottom: "32px",
        }}
      >
        <div>
          <Title level={3} style={{ margin: 0, marginBottom: "16px" }}>
            TTS 任务列表
          </Title>
          <Segmented
            options={[
              { label: "全部", value: "all" },
              { label: "等待中", value: "pending" },
              { label: "处理中", value: "processing" },
              { label: "已完成", value: "completed" },
              { label: "已暂停", value: "paused" },
              { label: "失败", value: "failed" },
            ]}
            value={filterStatus}
            onChange={(value) => {
              trackEvent({
                feature: "tts",
                eventName: "tts_task_filter_change",
                metadata: { filterStatus: String(value) },
              });
              setFilterStatus(value as string);
            }}
          />
        </div>

        <Flex gap={8}>
          <Button
            onClick={() => {
              trackEvent({
                feature: "tts",
                eventName: "tts_task_refresh",
              });
              fetchTasks(true);
            }}
            loading={loading}
          >
            手动刷新
          </Button>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => {
              trackEvent({
                feature: "tts",
                eventName: "tts_create_entry_click",
              });
              navigate("/tts/create");
            }}
          >
            创建任务
          </Button>
        </Flex>
      </div>
      <Table
        dataSource={filteredTasks}
        columns={columns}
        rowKey="id"
        loading={loading}
        scroll={{
          x: 800,
        }}
        pagination={false}
      />
    </div>
  );
};

export default TaskList;
