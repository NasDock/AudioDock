import { FolderOpenOutlined } from "@ant-design/icons";
import { Button, ColorPicker, Divider, Input, InputNumber, Select, Slider, Space, Switch, Typography, theme } from "antd";
import React from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "../../store/auth";
import { useSettingsStore } from "../../store/settings";
import AdminSettings from "./AdminSettings";
import styles from "./index.module.less";

const { Title, Text } = Typography;

const Settings: React.FC = () => {
  const { token } = theme.useToken();
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const {
    general,
    desktopLyric,
    download,
    updateGeneral,
    updateDesktopLyric,
    updateDownload,
  } = useSettingsStore();

  const [cacheSize, setCacheSize] = React.useState<string>("正在计算...");

  const fetchCacheSize = async () => {
    if ((window as any).ipcRenderer) {
      const size = await (window as any).ipcRenderer.invoke("cache:get-size");
      setCacheSize(formatSize(size));
    }
  };

  const formatSize = (bytes: number) => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  const handleClearCache = async () => {
    if ((window as any).ipcRenderer) {
      await (window as any).ipcRenderer.invoke("cache:clear");
      await fetchCacheSize();
    }
  };

  React.useEffect(() => {
    fetchCacheSize();
  }, []);

  const handleSelectDirectory = async () => {
    if ((window as any).ipcRenderer && (window as any).ipcRenderer.selectDirectory) {
      const path = await (window as any).ipcRenderer.selectDirectory();
      if (path) {
        updateDownload("downloadPath", path);
      }
    }
  };

  return (
    <div className={styles.settingsPage} style={{ color: token.colorText }}>
      <header className={styles.header}>
        <Title level={2} className={styles.title}>设置</Title>
      </header>

      {user?.is_admin && (
        <>
            <section className={styles.section}>
                <Title level={4} className={styles.sectionTitle}>管理后台</Title>
                <AdminSettings />
            </section>
            <Divider className={styles.divider} />
        </>
      )}
      
      <Divider className={styles.divider} />

      {/* General Settings */}
      <section className={styles.section}>
        <Title level={4} className={styles.sectionTitle}>通用</Title>
        <div className={styles.settingItem}>
            <div className={styles.label}>开机启动</div>
            <div className={styles.control}>
                <Space>
                    <Switch checked={general.autoLaunch} onChange={(val) => updateGeneral('autoLaunch', val)} />
                    <Text className={styles.description}>系统启动时自动运行应用</Text>
                </Space>
            </div>
        </div>
        <div className={styles.settingItem}>
            <div className={styles.label}>最小化到托盘</div>
            <div className={styles.control}>
                <Space>
                    <Switch checked={general.minimizeToTray} onChange={(val) => updateGeneral('minimizeToTray', val)} />
                    <Text className={styles.description}>关闭窗口时最小化到系统托盘</Text>
                </Space>
            </div>
        </div>
        <div className={styles.settingItem}>
            <div className={styles.label}>接力播放</div>
            <div className={styles.control}>
                <Space>
                    <Switch checked={general.acceptRelay} onChange={(val) => updateGeneral('acceptRelay', val)} />
                    <Text className={styles.description}>是否接受多设备之间播放接力</Text>
                </Space>
            </div>
        </div>
        <div className={styles.settingItem}>
            <div className={styles.label}>同步控制</div>
            <div className={styles.control}>
                <Space>
                    <Switch checked={general.acceptSync} onChange={(val) => updateGeneral('acceptSync', val)} />
                    <Text className={styles.description}>是否接受同数据源下其他用户的同步控制请求</Text>
                </Space>
            </div>
        </div>
        <div className={styles.settingItem}>
            <div className={styles.label}>推荐偏好</div>
            <div className={styles.control}>
                <div style={{ minWidth: 260 }}>
                    <Slider
                        min={0}
                        max={100}
                        step={5}
                        value={general.recommendationLikeRatio}
                        onChange={(val) => updateGeneral('recommendationLikeRatio', Number(val))}
                    />
                    <Text className={styles.description}>
                        喜欢 {general.recommendationLikeRatio}% · 新鲜 {100 - general.recommendationLikeRatio}%
                    </Text>
                </div>
            </div>
        </div>
        <div className={styles.settingItem}>
            <div className={styles.label}>语言</div>
            <div className={styles.control}>
                <Select
                    value={general.language}
                    onChange={(val) => updateGeneral('language', val)}
                    options={[
                        { label: "简体中文", value: "zh-CN" },
                        { label: "English", value: "en-US" }
                    ]}
                    className={styles.selectSmall}
                />
            </div>
        </div>
        <div className={styles.settingItem}>
            <div className={styles.label}>主题</div>
            <div className={styles.control}>
                <Select
                    value={general.theme}
                    onChange={(val) => updateGeneral('theme', val)}
                    options={[
                        { label: "跟随系统", value: "system" },
                        { label: "浅色", value: "light" },
                        { label: "深色", value: "dark" }
                    ]}
                    className={styles.selectSmall}
                />
            </div>
        </div>
      </section>

      <Divider className={styles.divider} />

      {/* Desktop Lyric Settings */}
      <section className={styles.section}>
        <Title level={4} className={styles.sectionTitle}>桌面歌词</Title>
        <div className={styles.settingItem}>
            <div className={styles.label}>桌面歌词</div>
            <div className={styles.control}>
                <Space>
                    <Switch checked={desktopLyric.enable} onChange={(val) => updateDesktopLyric('enable', val)} />
                    <Text className={styles.description}>启用桌面歌词</Text>
                </Space>
            </div>
        </div>
        <div className={styles.settingItem}>
            <div className={styles.label}>位置锁定</div>
            <div className={styles.control}>
                <Space>
                    <Switch checked={desktopLyric.lockPosition} onChange={(val) => updateDesktopLyric('lockPosition', val)} />
                    <Text className={styles.description}>锁定歌词窗口位置</Text>
                </Space>
            </div>
        </div>
        <div className={styles.settingItem}>
            <div className={styles.label}>字体大小</div>
            <div className={styles.control}>
                <InputNumber
                    min={16}
                    max={64}
                    value={desktopLyric.fontSize}
                    onChange={(val) => updateDesktopLyric('fontSize', val)}
                    addonAfter="px"
                    className={styles.inputNumber}
                />
            </div>
        </div>
        <div className={styles.settingItem}>
            <div className={styles.label}>字体粗细</div>
            <div className={styles.control}>
                <Select
                    value={desktopLyric.fontWeight}
                    onChange={(val) => updateDesktopLyric('fontWeight', val)}
                    options={[
                        { label: "更细 (100)", value: 100 },
                        { label: "细 (200)", value: 200 },
                        { label: "较细 (300)", value: 300 },
                        { label: "常规 (400)", value: 400 },
                        { label: "中等 (500)", value: 500 },
                        { label: "较粗 (600)", value: 600 },
                        { label: "粗 (700)", value: 700 },
                        { label: "很粗 (800)", value: 800 },
                        { label: "黑体 (900)", value: 900 }
                    ]}
                    className={styles.selectSmall}
                />
            </div>
        </div>
        <div className={styles.settingItem}>
            <div className={styles.label}>字体颜色</div>
            <div className={styles.control}>
                <ColorPicker
                    value={desktopLyric.fontColor}
                    onChange={(val) => updateDesktopLyric('fontColor', val.toHexString())}
                    showText
                />
            </div>
        </div>
        <div className={styles.settingItem}>
            <div className={styles.label}>描边粗细</div>
            <div className={styles.control}>
                <InputNumber
                    min={0}
                    max={10}
                    value={desktopLyric.strokeWidth}
                    onChange={(val) => updateDesktopLyric('strokeWidth', val)}
                    addonAfter="px"
                    className={styles.inputNumber}
                />
            </div>
        </div>
        <div className={styles.settingItem}>
            <div className={styles.label}>描边颜色</div>
            <div className={styles.control}>
                <ColorPicker
                    value={desktopLyric.strokeColor}
                    onChange={(val) => updateDesktopLyric('strokeColor', val?.toHexString?.() || val)}
                    showText
                />
            </div>
        </div>
        <div className={styles.settingItem}>
            <div className={styles.label}>文字阴影</div>
            <div className={styles.control}>
                <Space>
                    <Switch checked={desktopLyric.shadow} onChange={(val) => updateDesktopLyric('shadow', val)} />
                    <Text className={styles.description}>启用文字阴影效果</Text>
                </Space>
            </div>
        </div>
        <div className={styles.settingItem}>
            <div className={styles.label}>窗口置顶</div>
            <div className={styles.control}>
                <Space>
                    <Switch checked={desktopLyric.alwaysOnTop} onChange={(val) => updateDesktopLyric('alwaysOnTop', val)} />
                    <Text className={styles.description}>歌词窗口始终保持在最前端</Text>
                </Space>
            </div>
        </div>
      </section>

      <Divider className={styles.divider} />

      {/* Download Settings */}
      <section className={styles.section}>
        <Title level={4} className={styles.sectionTitle}>下载设置</Title>
        <div className={styles.settingItem}>
            <div className={styles.label}>存储位置</div>
            <div className={styles.control}>
                <Input
                    value={download.downloadPath}
                    readOnly
                    addonAfter={
                        <Button 
                            type="text" 
                            size="small" 
                            icon={<FolderOpenOutlined />} 
                            onClick={handleSelectDirectory}
                        />
                    }
                    className={styles.pathInput}
                    placeholder="音频文件和缓存文件的保存位置"
                />
            </div>
        </div>
        <div className={styles.settingItem}>
            <div className={styles.label}>下载品质</div>
            <div className={styles.control}>
                <Select
                    value={download.quality}
                    onChange={(val) => updateDownload('quality', val)}
                    options={[
                        { label: "标准 (128K)", value: "128k" },
                        { label: "高品质 (320K)", value: "320k" },
                        { label: "无损 (FLAC)", value: "flac" }
                    ]}
                    className={styles.selectMedium}
                />
            </div>
        </div>
        <div className={styles.settingItem}>
            <div className={styles.label}>同时下载数</div>
            <div className={styles.control}>
                <InputNumber
                    min={1}
                    max={10}
                    value={download.concurrentDownloads}
                    onChange={(val) => updateDownload('concurrentDownloads', val)}
                    className={styles.inputNumber}
                />
            </div>
        </div>
        <div className={styles.settingItem}>
            <div className={styles.label}>边听边存</div>
            <div className={styles.control}>
                <Space>
                    <Switch checked={download.cacheEnabled} onChange={(val) => updateDownload('cacheEnabled', val)} />
                    <Text className={styles.description}>播放网络音频时自动缓存到本地，下次播放优先使用缓存</Text>
                </Space>
            </div>
        </div>
        <div className={styles.settingItem}>
            <div className={styles.label}>清除缓存</div>
            <div className={styles.control}>
                <Space>
                    <Button onClick={handleClearCache}>立即清理</Button>
                    <Text className={styles.description}>当前已用缓存: {cacheSize}</Text>
                </Space>
            </div>
        </div>
      </section>

      <Divider className={styles.divider} />

      {/* About */}
      <section className={styles.section}>
        <Title level={4} className={styles.sectionTitle}>关于</Title>
        <div className={styles.settingItem}>
            <div className={styles.label}>产品动态</div>
            <div className={styles.control}>
                <Button type="link" onClick={() => navigate("/product-updates")}>
                    查看最新功能与版本更新
                </Button>
            </div>
        </div>
        <div className={styles.settingItem}>
            <div className={styles.label}>参与用户体验计划</div>
            <div className={styles.control}>
                <Space>
                    <Switch
                        checked={general.experienceProgramEnabled}
                        onChange={(val) => updateGeneral("experienceProgramEnabled", val)}
                    />
                    <Text className={styles.description}>允许匿名上报使用数据以改进产品</Text>
                </Space>
            </div>
        </div>
      </section>
    </div>
  );
};

export default Settings;
