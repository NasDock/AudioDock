import type { TtsTask, UnifiedTask } from "@soundx/services";
import {
    TASK_CATEGORY_I18N_KEY,
    TASK_STATUS_I18N_KEY,
    deleteTtsTask,
    fetchAllTasks,
    isTaskActive,
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
import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

const { Title, Text } = Typography;

// 轮询策略：有进行中任务时 2s 高频刷新；没有时退到 30s 慢轮询（避免空跑打爆接口）
const ACTIVE_POLL_MS = 2000;
const IDLE_POLL_MS = 30000;

// 统一状态 → antd Tag 颜色（沿用 TTS 列表页既有色板）
const STATUS_COLOR: Record<UnifiedTask["status"], string> = {
  pending: "cyan",
  processing: "orange",
  paused: "default",
  success: "green",
  failed: "red",
};

const TaskCenter: React.FC = () => {
  const { t } = useTranslation();
  const [tasks, setTasks] = useState<UnifiedTask[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<"all" | "active">("all");
  const tasksRef = useRef<UnifiedTask[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchTasks = async (showLoading = true) => {
    if (showLoading) setLoading(true);
    try {
      const list = await fetchAllTasks();
      tasksRef.current = list;
      setTasks(list);
    } catch (error) {
      console.error("Failed to fetch tasks:", error);
    } finally {
      if (showLoading) setLoading(false);
    }
  };

  // 根据当前任务列表自适应调度下一次轮询
  const scheduleNext = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    const hasActive = tasksRef.current.some(isTaskActive);
    const delay = hasActive ? ACTIVE_POLL_MS : IDLE_POLL_MS;
    timerRef.current = setTimeout(async () => {
      await fetchTasks(false);
      scheduleNext();
    }, delay);
  };

  useEffect(() => {
    fetchTasks().then(() => scheduleNext());
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleTtsAction = async (
    action: "pause" | "resume" | "delete",
    id: string
  ) => {
    try {
      if (action === "delete") await deleteTtsTask(id);
      else if (action === "pause") await pauseTtsTask(id);
      else if (action === "resume") await resumeTtsTask(id);
      await fetchTasks(false);
      scheduleNext();
    } catch (error) {
      console.error(`Failed to ${action} task:`, error);
    }
  };

  const filteredTasks =
    filter === "all" ? tasks : tasks.filter(isTaskActive);

  const displayTitle = (record: UnifiedTask) =>
    record.source === "tts"
      ? record.title || t(TASK_CATEGORY_I18N_KEY[record.category])
      : t(TASK_CATEGORY_I18N_KEY[record.category]);

  const columns = [
    {
      title: t("taskCenter.columnName"),
      key: "title",
      width: 180,
      fixed: "left" as any,
      render: (_: any, record: UnifiedTask) => (
        <div>
          <div>{displayTitle(record)}</div>
          {record.subtitle && (
            <Text type="secondary" style={{ fontSize: 12 }}>
              {record.subtitle}
            </Text>
          )}
        </div>
      ),
    },
    {
      title: t("taskCenter.columnCategory"),
      dataIndex: "category",
      key: "category",
      width: 120,
      render: (_: any, record: UnifiedTask) => (
        <Tag>{t(TASK_CATEGORY_I18N_KEY[record.category])}</Tag>
      ),
    },
    {
      title: t("taskCenter.columnStatus"),
      dataIndex: "status",
      key: "status",
      width: 100,
      render: (_: any, record: UnifiedTask) => (
        <Tag color={STATUS_COLOR[record.status]}>
          {t(TASK_STATUS_I18N_KEY[record.status])}
        </Tag>
      ),
    },
    {
      title: t("taskCenter.columnProgress"),
      key: "progress",
      width: 220,
      render: (_: any, record: UnifiedTask) => {
        const isTts = record.source === "tts";
        const raw = record.raw as TtsTask;
        return (
          <div style={{ width: 180 }}>
            <Progress
              percent={record.progress}
              size="small"
              status={
                record.status === "failed"
                  ? "exception"
                  : record.status === "success"
                    ? "success"
                    : "active"
              }
            />
            {isTts && (
              <div style={{ fontSize: 12, color: "#999" }}>
                {raw.completed_chapters} / {raw.total_chapters}{" "}
                {t("taskCenter.chapters")}
              </div>
            )}
          </div>
        );
      },
    },
    {
      title: t("taskCenter.columnAction"),
      key: "action",
      fixed: "right" as any,
      width: 160,
      render: (_: any, record: UnifiedTask) => {
        if (record.source !== "tts") {
          // 导入类任务只读
          return <Text type="secondary">—</Text>;
        }
        return (
          <Space size="small">
            {record.status === "processing" && (
              <Button
                type="link"
                size="small"
                onClick={() => handleTtsAction("pause", record.id)}
              >
                {t("taskCenter.pause")}
              </Button>
            )}
            {(record.status === "paused" ||
              record.status === "failed" ||
              record.status === "pending") && (
              <Button
                type="link"
                size="small"
                onClick={() => handleTtsAction("resume", record.id)}
              >
                {t("taskCenter.resume")}
              </Button>
            )}
            <Button
              type="link"
              size="small"
              danger
              onClick={() => handleTtsAction("delete", record.id)}
            >
              {t("taskCenter.delete")}
            </Button>
          </Space>
        );
      },
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
            {t("taskCenter.title")}
          </Title>
          <Segmented
            options={[
              { label: t("taskCenter.all"), value: "all" },
              { label: t("taskCenter.active"), value: "active" },
            ]}
            value={filter}
            onChange={(value) => setFilter(value as "all" | "active")}
          />
        </div>
        <Flex gap={8}>
          <Button
            onClick={async () => {
              await fetchTasks(true);
              scheduleNext();
            }}
            loading={loading}
          >
            {t("taskCenter.refresh")}
          </Button>
        </Flex>
      </div>
      <Table
        dataSource={filteredTasks}
        columns={columns}
        rowKey="id"
        loading={loading}
        scroll={{ x: 800 }}
        pagination={false}
        locale={{ emptyText: t("taskCenter.empty") }}
      />
    </div>
  );
};

export default TaskCenter;
