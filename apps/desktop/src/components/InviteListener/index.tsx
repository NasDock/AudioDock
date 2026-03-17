import { Button, notification, Space, Typography } from "antd";
import React, { useEffect } from "react";
import type { Track } from "../../models";
import { socketService } from "../../services/socket";
import { trackEvent } from "../../services/tracking";
import { usePlayerStore } from "../../store/player";
import { useSettingsStore } from "../../store/settings";
import { useAuthStore } from "../../store/auth";
import { getCoverUrl } from "../../utils";

const { Text } = Typography;

const InviteContent: React.FC<{
  fromUserId: number;
  fromUsername?: string;
  fromDeviceName?: string;
  currentTrack?: Track;
}> = ({ fromUserId, fromUsername, fromDeviceName, currentTrack }) => {
  return (
    <div>
      <div style={{ marginBottom: 12 }}>
        <Text strong>{fromUsername || `用户 ${fromUserId}`} {fromDeviceName ? `(${fromDeviceName})` : ''}</Text> 邀请你一同听歌
      </div>
      {currentTrack && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 12,
            padding: 8,
            background: "rgba(255,255,255,0.05)",
            borderRadius: 4,
          }}
        >
          {currentTrack.cover && (
            <img
              src={`${getCoverUrl(currentTrack.cover)}`}
              alt="cover"
              style={{
                width: 40,
                height: 40,
                borderRadius: 4,
                objectFit: "cover",
              }}
            />
          )}
          <div style={{ overflow: "hidden" }}>
            <div
              style={{
                fontWeight: "bold",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {currentTrack.name}
            </div>
            <div
              style={{
                fontSize: 12,
                opacity: 0.7,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {currentTrack.artist}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const InviteListener: React.FC = () => {
  const [api, contextHolder] = notification.useNotification();
  const { play, setPlaylist } = usePlayerStore();
  const { user, device } = useAuthStore();

  useEffect(() => {
    const handleInviteReceived = (payload: {
      fromUserId: number;
      fromUsername?: string;
      fromDeviceName?: string;
      fromSocketId?: string;
      sessionId?: string;
      currentTrack?: Track;
      playlist?: Track[];
      progress?: number;
    }) => {
      console.log("InviteListener", payload);
      const key = `invite-${payload.fromUserId}`; // Fixed key to prevent duplicates

      const { acceptSync } = useSettingsStore.getState().general;
      if (!acceptSync) {
        socketService.emit("respond_invite", {
          fromUserId: payload.fromUserId,
          fromSocketId: payload.fromSocketId,
          sessionId: payload.sessionId,
          accept: false,
        });
        return;
      }

      const handleRespond = (accept: boolean) => {
        socketService.emit("respond_invite", {
          fromUserId: payload.fromUserId,
          fromSocketId: payload.fromSocketId,
          sessionId: payload.sessionId,
          accept,
        });
        api.destroy(key);

        if (accept) {
          trackEvent({
            feature: "sync",
            eventName: "sync_control_accept",
            userId: user?.id ? String(user.id) : undefined,
            sessionId: payload.sessionId,
            deviceId: device?.id ? String(device.id) : undefined,
            metadata: {
              fromUserId: payload.fromUserId,
            },
          });
          if (payload.currentTrack) {
            const onSessionStart = () => {
              play(payload.currentTrack, payload.currentTrack?.albumEntity?.id, payload.progress || 0);
              socketService.off("sync_session_started", onSessionStart);
            };
            socketService.on("sync_session_started", onSessionStart);
          }
          if (payload.playlist) {
            setPlaylist(payload.playlist);
          }
        }
      };
      
      // Auto-close if handled elsewhere
      const handleInviteHandled = (evtPayload: { fromUserId: number }) => {
           if (evtPayload.fromUserId === payload.fromUserId) {
               api.destroy(key);
               // socketService.off logic handled in cleanup? 
               // This is a one-time listener per notification, effectively.
           }
      };
      socketService.on("invite_handled", handleInviteHandled);

      const btn = (
        <Space>
          <Button size="small" onClick={() => handleRespond(false)}>
            拒绝
          </Button>
          <Button
            type="primary"
            size="small"
            onClick={() => handleRespond(true)}
          >
            接受
          </Button>
        </Space>
      );

      api.open({
        message: "来自好友的邀请",
        description: (
          <InviteContent
            fromUserId={payload.fromUserId}
            fromUsername={payload.fromUsername}
            fromDeviceName={payload.fromDeviceName}
            currentTrack={payload.currentTrack}
          />
        ),
        key,
        showProgress: true,
        pauseOnHover: false,
        duration: 60, // Keep open until user interacts or manually closed by timer
        btn,
        placement: "topRight",
        onClose: () => {
            socketService.off("invite_handled", handleInviteHandled);
        }
      });
    };

    socketService.on("invite_received", handleInviteReceived);

    return () => {
      socketService.off("invite_received", handleInviteReceived);
    };
  }, [api, play]);

  return <>{contextHolder}</>;
};

export default InviteListener;
