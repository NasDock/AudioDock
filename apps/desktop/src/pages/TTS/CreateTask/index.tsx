import {
  ArrowLeftOutlined,
  CheckCircleOutlined,
  DownloadOutlined,
  FileTextOutlined,
  RocketOutlined,
  SoundOutlined,
  UploadOutlined,
} from "@ant-design/icons";
import type { TtsFileItem as FileItem, TtsReviewItem as ReviewItem, TtsVoice } from "@soundx/services";
import {
  createTtsBatchTasks,
  getTtsLocalFiles,
  getTtsPreviewUrl,
  getTtsVoices,
  identifyTtsBatch,
  uploadTtsFile,
} from "@soundx/services";
import {
  Button,
  Card,
  Empty,
  Flex,
  Input,
  message,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  Upload,
} from "antd";
import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { trackEvent } from "../../../services/tracking";

const { Title, Text } = Typography;
const { Option } = Select;

// Types are now imported from @soundx/services

const CreateTask: React.FC = () => {
  const navigate = useNavigate();
  const audioRef = useRef<HTMLAudioElement>(null);
  const previewObjectUrlRef = useRef<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [previewLoading, setPreviewLoading] = useState<string | null>(null);
  const [voices, setVoices] = useState<TtsVoice[]>([]);
  const [localFiles, setLocalFiles] = useState<FileItem[]>([]);
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [selectedVoice, setSelectedVoice] = useState("zh-CN-XiaoxiaoNeural");

  // 视图切换：'select' | 'review'
  const [view, setView] = useState<"select" | "review">("select");
  const [reviewData, setReviewData] = useState<ReviewItem[]>([]);

  const fetchVoices = async () => {
    try {
      const data = await getTtsVoices();
      if (Array.isArray(data)) {
        setVoices(data);
      }
    } catch (err) {
      console.error("Failed to fetch voices", err);
    }
  };

  const fetchLocalFiles = async () => {
    setLoading(true);
    try {
      const res = await getTtsLocalFiles();
      if (res.success) {
        setLocalFiles(res.files);
      }
    } catch (err) {
      message.error("获取本地文件列表失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchVoices();
    fetchLocalFiles();
    return () => {
      if (previewObjectUrlRef.current) {
        URL.revokeObjectURL(previewObjectUrlRef.current);
        previewObjectUrlRef.current = null;
      }
    };
  }, []);

  const handlePreview = async (voice: string) => {
    if (previewLoading) return;
    setPreviewLoading(voice);
    trackEvent({
      feature: "tts",
      eventName: "tts_voice_preview",
      metadata: { voice },
    });
    try {
      const previewUrl = getTtsPreviewUrl(voice);
      if (audioRef.current) {
        const response = await fetch(previewUrl);
        if (!response.ok) {
          throw new Error(`Preview request failed: ${response.status}`);
        }

        const audioBlob = await response.blob();
        if (previewObjectUrlRef.current) {
          URL.revokeObjectURL(previewObjectUrlRef.current);
        }
        previewObjectUrlRef.current = URL.createObjectURL(audioBlob);

        audioRef.current.pause();
        audioRef.current.currentTime = 0;
        audioRef.current.src = previewObjectUrlRef.current;
        audioRef.current.load();

        // 只有当音频真正开始播放（意味着后端已经合成完毕并返回）时才取消加载状态
        audioRef.current.onplaying = () => {
          setPreviewLoading(null);
        };

        audioRef.current.onerror = () => {
          message.error("试听音频加载失败");
          setPreviewLoading(null);
        };

        await audioRef.current.play();
      }
    } catch (err) {
      console.error("Preview failed", err);
      setPreviewLoading(null);
    }
  };

  const handleUpload = async (options: any) => {
    const { file, onSuccess, onError } = options;
    setLoading(true);
    trackEvent({
      feature: "tts",
      eventName: "tts_upload_single_file",
      metadata: {
        fileName: file?.name || "",
      },
    });
    try {
      const res = await uploadTtsFile(file);
      if (res.success) {
        const newItem: ReviewItem = {
          key: `upload_${Date.now()}`,
          filename: res.filename,
          full_path: res.temp_path,
          title: res.title || res.filename.replace(".txt", ""),
          author: res.author || "Unknown",
          voice: selectedVoice,
          temp_path: res.temp_path,
          file_id: res.file_id,
        };
        setReviewData([newItem, ...reviewData]);
        setView("review");
        onSuccess("ok");
      }
    } catch (error) {
      message.error("文件上传解析失败");
      onError(error);
    } finally {
      setLoading(false);
    }
  };

  const handleBatchIdentify = async () => {
    if (selectedRowKeys.length === 0) {
      message.warning("请至少选择一个文件");
      return;
    }

    setLoading(true);
    trackEvent({
      feature: "tts",
      eventName: "tts_batch_identify",
      metadata: { selectedCount: selectedRowKeys.length },
    });
    try {
      const res = await identifyTtsBatch(selectedRowKeys as string[]);

      if (res.success) {
        const items: ReviewItem[] = res.results.map((r: any) => ({
          key: r.full_path,
          filename: r.filename,
          full_path: r.full_path,
          title: r.title,
          author: r.author,
          voice: selectedVoice, // 初始使用页面选择的预设音色
        }));
        setReviewData(items);
        setView("review");
      }
    } catch (err) {
      message.error("文件识别失败");
    } finally {
      setLoading(false);
    }
  };

  const handleProcessAll = async () => {
    setLoading(true);
    trackEvent({
      feature: "tts",
      eventName: "tts_task_submit",
      metadata: { taskCount: reviewData.length },
    });
    try {
      const res = await createTtsBatchTasks(
        reviewData.map((item) => ({
          full_path: item.full_path,
          title: item.title,
          author: item.author,
          voice: item.voice,
          file_id: item.file_id,
          temp_path: item.temp_path,
        }))
      );

      if (res.success) {
        message.success(`成功开启 ${res.count} 个任务`);
        navigate("/tts/tasks");
      }
    } catch (err) {
      message.error("开启任务失败");
    } finally {
      setLoading(false);
    }
  };

  const updateReviewItem = (
    key: string,
    field: keyof ReviewItem,
    value: string,
  ) => {
    setReviewData((prev) =>
      prev.map((item) =>
        item.key === key ? { ...item, [field]: value } : item,
      ),
    );
  };

  const selectColumns = [
    {
      title: "文件名",
      dataIndex: "filename",
      key: "filename",
      render: (text: string) => (
        <Space>
          <FileTextOutlined style={{ color: "#1890ff" }} />
          <Text>{text}</Text>
        </Space>
      ),
    },
    {
      title: "状态",
      dataIndex: "is_generated",
      key: "is_generated",
      width: 100,
      render: (done: boolean) =>
        done ? (
          <Tag color="success">已生成</Tag>
        ) : (
          <Tag color="default">未生成</Tag>
        ),
    },
    {
      title: "全路径",
      dataIndex: "full_path",
      key: "full_path",
      ellipsis: true,
      render: (path: string) => (
        <Text type="secondary" style={{ fontSize: "12px" }}>
          {path}
        </Text>
      ),
    },
  ];

  const reviewColumns = [
    {
      title: "作品标题 (可修改)",
      dataIndex: "title",
      key: "title",
      render: (text: string, record: ReviewItem) => (
        <Input
          value={text}
          onChange={(e) =>
            updateReviewItem(record.key, "title", e.target.value)
          }
        />
      ),
    },
    {
      title: "作者",
      dataIndex: "author",
      key: "author",
      width: 150,
      render: (text: string, record: ReviewItem) => (
        <Input
          value={text}
          onChange={(e) =>
            updateReviewItem(record.key, "author", e.target.value)
          }
        />
      ),
    },
    {
      title: "针对此本选择音色",
      dataIndex: "voice",
      key: "voice",
      width: 320,
      render: (voice: string, record: ReviewItem) => (
        <Space>
          <Select
            style={{ width: 220 }}
            value={voice}
            onChange={(val) => updateReviewItem(record.key, "voice", val)}
          >
            {voices.map((v) => (
              <Option key={v.value} value={v.value}>
                {v.label}
              </Option>
            ))}
          </Select>
          <Button
            icon={<SoundOutlined />}
            onClick={() => handlePreview(voice)}
            loading={previewLoading === voice}
          >
            试听
          </Button>
        </Space>
      ),
    },
    {
      title: "操作",
      key: "action",
      width: 80,
      render: (_: any, record: ReviewItem) => (
        <Button
          type="link"
          danger
          onClick={() =>
            setReviewData((prev) => prev.filter((i) => i.key !== record.key))
          }
        >
          移除
        </Button>
      ),
    },
  ];

  return (
    <div
      style={{
        padding: "24px",
        height: "100%",
        overflowY: "auto",
        backgroundColor: "rgba(255, 255, 255, 0.1)",
        backdropFilter: "blur(100px)",
      }}
    >
      {/* 隐藏的音频标签用于播放试听 */}
      <audio ref={audioRef} style={{ display: "none" }} />

      {view === "select" ? (
        <>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "32px",
            }}
          >
            <Flex gap={8} align="center">
              <Button
                type="text"
                onClick={() => {
                  trackEvent({
                    feature: "tts",
                    eventName: "tts_task_list_open",
                  });
                  navigate("/tts/tasks");
                }}
              >
                <ArrowLeftOutlined />
                返回任务列表
              </Button>
              <Title level={3} style={{ margin: 0 }}>
                创建 TTS 转换任务
              </Title>
            </Flex>
            <Space>
              <Upload
                accept=".txt"
                customRequest={handleUpload}
                showUploadList={false}
              >
                <Button icon={<UploadOutlined />} loading={loading}>
                  上传单文件
                </Button>
              </Upload>
              <Button
                type="primary"
                icon={<RocketOutlined />}
                onClick={handleBatchIdentify}
                loading={loading}
                disabled={selectedRowKeys.length === 0}
              >
                下一步确认 ({selectedRowKeys.length})
              </Button>
            </Space>
          </div>

          <Card
            size="small"
            style={{
              marginBottom: "24px",
              background: "rgba(255,255,255,0.02)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              <Text strong>预设音色：</Text>
              <Space>
                <Select
                  style={{ width: 250 }}
                  value={selectedVoice}
                  onChange={setSelectedVoice}
                >
                  {voices.map((v) => (
                    <Option key={v.value} value={v.value}>
                      {v.label}
                    </Option>
                  ))}
                </Select>
                <Button
                  icon={<SoundOutlined />}
                  onClick={() => handlePreview(selectedVoice)}
                  loading={previewLoading === selectedVoice}
                >
                  试听音色
                </Button>
              </Space>
              <div style={{ flex: 1 }} />
            </div>
          </Card>

          <Flex justify="space-between" style={{ marginBottom: "16px" }}>
            <Text type="secondary">
              扫描目录：
              {localFiles.length > 0
                ? localFiles[0].full_path.split("/").slice(0, -1).join("/")
                : "加载中..."}
            </Text>
            <Button
              icon={<DownloadOutlined />}
              onClick={fetchLocalFiles}
              loading={loading}
            >
              刷新目录
            </Button>
          </Flex>

          <Table
            dataSource={localFiles}
            columns={selectColumns}
            rowKey="full_path"
            loading={loading}
            pagination={false}
            rowSelection={{
              selectedRowKeys,
              onChange: (keys) => setSelectedRowKeys(keys),
              getCheckboxProps: (record) => ({
                disabled: record.is_generated,
              }),
            }}
            locale={{ emptyText: <Empty description="目录下无 .txt 文件" /> }}
          />
        </>
      ) : (
        <>
          <div
            style={{
              display: "flex",
              width: "100%",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "32px",
            }}
          >
            <Button
              type="text"
              icon={<ArrowLeftOutlined />}
              onClick={() => setView("select")}
            >
              返回选择
            </Button>
            <Button
              type="primary"
              icon={<CheckCircleOutlined />}
              onClick={handleProcessAll}
              loading={loading}
            >
              确认并启动共 {reviewData.length} 个任务
            </Button>
          </div>

          <Table
            dataSource={reviewData}
            columns={reviewColumns}
            rowKey="key"
            pagination={false}
            loading={loading}
          />
        </>
      )}
    </div>
  );
};

export default CreateTask;
