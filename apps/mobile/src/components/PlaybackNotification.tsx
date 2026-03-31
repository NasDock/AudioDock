import { Ionicons } from '@expo/vector-icons';
import { useSegments } from 'expo-router';
import React, { useEffect, useRef } from 'react';
import { Animated, Image, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNotification } from '../context/NotificationContext';
import { useTheme } from '../context/ThemeContext';
import { getBaseURL } from '../https';

const PlaybackNotification: React.FC = () => {
  const { notification, hideNotification } = useNotification();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const segments = useSegments();
  const translateY = useRef(new Animated.Value(-300)).current;
  const currentTabSegment = String(segments[1] || "");
  const isHomeTab =
    segments[0] === "(tabs)" && (!currentTabSegment || currentTabSegment === "index");
  const shouldShowNotification =
    !!notification && (notification.type !== "resume" || isHomeTab);

  useEffect(() => {
    if (shouldShowNotification) {
      Animated.spring(translateY, {
        toValue: insets.top + 10,
        useNativeDriver: true,
        friction: 8,
        tension: 40,
      }).start();

      const timer = setTimeout(() => {
        handleReject();
      }, 15000); // Increased to 15s since there is more text now

      return () => clearTimeout(timer);
    } else {
      Animated.timing(translateY, {
        toValue: -300,
        duration: 300,
        useNativeDriver: true,
      }).start();
    }
  }, [shouldShowNotification, insets.top]);

  const handleAccept = () => {
    notification?.onAccept();
    hideNotification();
  };

  const handleReject = () => {
    notification?.onReject();
    hideNotification();
  };

  if (!notification || !shouldShowNotification) return null;

  const artwork = notification.track.cover 
    ? (notification.track.cover.startsWith('http') ? notification.track.cover : `${getBaseURL()}${notification.track.cover}`) 
    : null;

  return (
    <Modal
      transparent
      visible={!!notification}
      animationType="none"
      pointerEvents="box-none"
    >
      <Animated.View style={[styles.container, { transform: [{ translateY }] }]}>
        <View style={[styles.content, { backgroundColor: colors.card, shadowColor: colors.text }]}>
          <View style={styles.header}>
            <Text style={[styles.title, { color: colors.text }]}>
              {notification.title}
            </Text>
            <Text style={[styles.description, { color: colors.secondary }]}>
              {notification.description}
            </Text>
          </View>

          <View style={[styles.trackCard, { backgroundColor: colors.background + '80' }]}>
            {artwork && (
              <Image source={{ uri: artwork }} style={styles.cover} />
            )}
            <View style={styles.trackInfo}>
              <Text style={[styles.trackName, { color: colors.text }]} numberOfLines={1}>
                {notification.track.name}
              </Text>
              <Text style={[styles.trackArtist, { color: colors.secondary }]} numberOfLines={1}>
                {notification.track.artist}
              </Text>
            </View>
            <View style={styles.actions}>
              <TouchableOpacity 
                style={[styles.btn, { backgroundColor: colors.border }]} 
                onPress={handleReject}
              >
                <Ionicons name="close" size={20} color={colors.text} />
              </TouchableOpacity>
              <TouchableOpacity 
                style={[styles.btn, { backgroundColor: colors.primary }]} 
                onPress={handleAccept}
              >
                <Ionicons name="checkmark" size={20} color={colors.background} />
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Animated.View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    right: 12,
    maxWidth: 350,
    alignSelf: 'flex-end',
    width: '100%',
    zIndex: 10000,
  },
  content: {
    borderRadius: 20,
    padding: 16,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 12,
  },
  header: {
    marginBottom: 12,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 4,
  },
  description: {
    fontSize: 14,
    lineHeight: 20,
  },
  trackCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderRadius: 12,
  },
  cover: {
    width: 44,
    height: 44,
    borderRadius: 8,
  },
  trackInfo: {
    flex: 1,
    marginLeft: 12,
  },
  trackName: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 2,
  },
  trackArtist: {
    fontSize: 12,
  },
  actions: {
    flexDirection: 'row',
    gap: 8,
    marginLeft: 8,
  },
  btn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
});

export default PlaybackNotification;
