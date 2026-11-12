import { DownloadOutlined } from '@ant-design/icons';
import { useTranslation } from "react-i18next";
import { Button, Modal, Typography } from 'antd';
import React from 'react';
import type { UpdateInfo } from '../hooks/useCheckUpdate';

import MarkdownContent from './MarkdownContent';
import { isWeb } from '../utils/platform';

const { Paragraph, Text } = Typography;

interface UpdateModalProps {
  visible: boolean;
  updateInfo: UpdateInfo | null;
  onCancel: () => void;
  /** 点击「去下载」：由 hook 负责刷新下载直链并交给系统浏览器 */
  onDownload: () => void;
}

/** 字节数转可读大小（弹窗里展示安装包体积） */
const formatFileSize = (bytes?: number): string => {
  if (!bytes || bytes <= 0) return '';
  const mb = bytes / 1024 / 1024;
  if (mb >= 1) return `${mb.toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
};

const UpdateModal: React.FC<UpdateModalProps> = ({ visible, updateInfo, onCancel, onDownload }) => {
  const { t } = useTranslation();
  if (!updateInfo) return null;
  const isWebRuntime = isWeb();

  // 仅服务端更新：简化提醒视图，单按钮关闭，无下载入口
  if (updateInfo.serverOnly) {
    return (
      <Modal
        title={t('updateModal.serverNoticeTitle')}
        open={visible}
        onCancel={onCancel}
        footer={[
          <Button key="ok" type="primary" onClick={onCancel}>
            {t('common.ok')}
          </Button>,
        ]}
      >
        <Paragraph>
          <Text type="secondary">
            {t('updateModal.serverNoticeBody', { version: updateInfo.version })}
          </Text>
        </Paragraph>
        <div style={{ maxHeight: '400px', overflowY: 'auto', padding: '10px 0' }}>
          <Paragraph>
            <Text strong>{t('updateModal.updateContent')}</Text>
          </Paragraph>
          <div style={{ lineHeight: '1.6' }}>
            <MarkdownContent>{updateInfo.body}</MarkdownContent>
          </div>
        </div>
      </Modal>
    );
  }

  const packageSize = formatFileSize(updateInfo.fileSize);
  const packageSummary = [updateInfo.fileName, packageSize].filter(Boolean).join(' · ');

  return (
    <Modal
      title={t('updateModal.newVersion', { version: updateInfo.version })}
      open={visible}
      onCancel={onCancel}
      footer={[
        <Button key="cancel" onClick={onCancel}>
          {isWebRuntime ? t('common.ok') : t('updateModal.updateLater')}
        </Button>,
        ...(!isWebRuntime
          ? [
              <Button
                key="download"
                type="primary"
                icon={<DownloadOutlined />}
                onClick={onDownload}
              >
                {t('updateModal.goToDownload')}
              </Button>,
            ]
          : []),
      ]}
    >
      {isWebRuntime && (
        <Paragraph>
          <Text type="secondary">
            {t('updateModal.webUpdateNote')}
          </Text>
        </Paragraph>
      )}
      {!isWebRuntime && packageSummary && (
        <Paragraph>
          <Text type="secondary">{packageSummary}</Text>
        </Paragraph>
      )}
      <div style={{ maxHeight: '400px', overflowY: 'auto', padding: '10px 0' }}>
        <Paragraph>
          <Text strong>{t('updateModal.updateContent')}</Text>
        </Paragraph>
        <div style={{ lineHeight: '1.6' }}>
            <MarkdownContent>
              {updateInfo.body}
            </MarkdownContent>
        </div>
      </div>
    </Modal>
  );
};

export default UpdateModal;
