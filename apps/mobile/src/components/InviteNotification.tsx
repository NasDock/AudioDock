import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSettings } from '../context/SettingsContext';
import { useSync } from '../context/SyncContext';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { trackEvent } from '../services/tracking';

const InviteNotification: React.FC = () => {
  const { invites, acceptInvite, rejectInvite } = useSync();
  const { colors } = useTheme();
  const { carLayoutMode } = useSettings();
  const { user, device } = useAuth();
  const [currentInvite, setCurrentInvite] = useState<any>(invites[0] || null);
  const translateY = useRef(new Animated.Value(-100)).current;

  useEffect(() => {
    if (invites.length > 0 && !currentInvite) {
      setCurrentInvite(invites[0]);
    }
  }, [invites]);

  useEffect(() => {
    if (currentInvite) {
      Animated.spring(translateY, {
        toValue: 50,
        useNativeDriver: true,
      }).start();
      
      const timer = setTimeout(() => {
        handleReject();
      }, 15000); // 15s auto reject

      return () => clearTimeout(timer);
    } else {
      Animated.timing(translateY, {
        toValue: -150,
        duration: 300,
        useNativeDriver: true,
      }).start();
    }
  }, [currentInvite]);

  const handleAccept = () => {
    if (currentInvite) {
      acceptInvite(currentInvite);
      trackEvent({
        feature: "sync",
        eventName: "sync_control_accept",
        userId: user?.id ? String(user.id) : undefined,
        sessionId: currentInvite?.sessionId,
        deviceId: device?.id ? String(device.id) : undefined,
        metadata: {
          fromUserId: currentInvite?.fromUserId,
        },
      });
      setCurrentInvite(null);
    }
  };

  const handleReject = () => {
    if (currentInvite) {
      rejectInvite(currentInvite);
      setCurrentInvite(null);
    }
  };

  if (!currentInvite) return null;

  return (
    <Modal
      transparent
      visible={!!currentInvite}
      animationType="none"
      onRequestClose={() => setCurrentInvite(null)}
    >
      <View style={{ flex: 1 }} pointerEvents="box-none">
        <Animated.View
          style={[
            styles.container,
            carLayoutMode ? styles.containerLeft : styles.containerRight,
            { transform: [{ translateY }] },
          ]}
        >
          <View style={[styles.content, { backgroundColor: colors.card }]}>
            <View style={styles.textContainer}>
              <Text style={[styles.title, { color: colors.text }]}>同步播放邀请</Text>
              <Text style={[styles.desc, { color: colors.secondary }]}>
                来自 {currentInvite.fromUsername} ({currentInvite.fromDeviceName})
              </Text>
              {currentInvite.currentTrack && (
                <Text style={[styles.track, { color: colors.secondary }]} numberOfLines={1}>
                  正在播放: {currentInvite.currentTrack.name}
                </Text>
              )}
            </View>
            <View style={styles.actions}>
              <TouchableOpacity 
                style={[styles.btn, styles.btnReject, { backgroundColor: colors.border }]} 
                onPress={handleReject}
              >
                <Ionicons name="close" size={20} color={colors.secondary} />
              </TouchableOpacity>
              <TouchableOpacity 
                style={[styles.btn, styles.btnAccept, { backgroundColor: colors.primary }]} 
                onPress={handleAccept}
              >
                <Ionicons name="checkmark" size={20} color={colors.background} />
              </TouchableOpacity>
            </View>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    maxWidth: 350,
    width: '100%',
    zIndex: 9999,
  },
  containerRight: {
    right: 12,
    alignSelf: 'flex-end',
  },
  containerLeft: {
    left: 12,
    alignSelf: 'flex-start',
  },
  content: {
    borderRadius: 12,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 4.65,
    elevation: 8,
  },
  textContainer: {
    flex: 1,
  },
  title: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  desc: {
    fontSize: 14,
    marginBottom: 2,
  },
  track: {
    fontSize: 12,
  },
  actions: {
    flexDirection: 'row',
    gap: 12,
    marginLeft: 12,
  },
  btn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  btnAccept: {
  },
  btnReject: {
  },
});

export default InviteNotification;
