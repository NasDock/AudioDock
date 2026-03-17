import { DownloadOutlined } from '@ant-design/icons';
import { Button, Modal, Typography } from 'antd';
import React from 'react';
import type { UpdateInfo } from '../hooks/useCheckUpdate';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { isWeb } from '../utils/platform';

const { Paragraph, Text } = Typography;

interface UpdateModalProps {
  visible: boolean;
  updateInfo: UpdateInfo | null;
  onCancel: () => void;
}

const UpdateModal: React.FC<UpdateModalProps> = ({ visible, updateInfo, onCancel }) => {
  if (!updateInfo) return null;
  const isWebRuntime = isWeb();

  const handleDownload = () => {
    if (updateInfo.downloadUrl) {
        if ((window as any).ipcRenderer) {
            (window as any).ipcRenderer.openExternal(updateInfo.downloadUrl);
        } else {
            window.open(updateInfo.downloadUrl, '_blank');
        }
    }
  };

  return (
    <Modal
      title={`发现新版本 ${updateInfo.version}`}
      open={visible}
      onCancel={onCancel}
      footer={[
        <Button key="cancel" onClick={onCancel}>
          {isWebRuntime ? "我知道了" : "暂不更新"}
        </Button>,
        ...(!isWebRuntime
          ? [
              <Button
                key="download"
                type="primary"
                icon={<DownloadOutlined />}
                onClick={handleDownload}
              >
                去下载
              </Button>,
            ]
          : []),
      ]}
    >
      {isWebRuntime && (
        <Paragraph>
          <Text type="secondary">
            Web 端请通过 Docker 镜像更新服务，客户端无需下载安装包。
          </Text>
        </Paragraph>
      )}
      <div style={{ maxHeight: '400px', overflowY: 'auto', padding: '10px 0' }}>
        <Paragraph>
          <Text strong>更新内容：</Text>
        </Paragraph>
        <div style={{ lineHeight: '1.6' }}>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {updateInfo.body}
            </ReactMarkdown>
        </div>
      </div>
    </Modal>
  );
};

export default UpdateModal;
