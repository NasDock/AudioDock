import { Ionicons } from '@expo/vector-icons';
import { getUserList } from '@soundx/services';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  FlatList,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../context/AuthContext';
import { usePlayer } from '../context/PlayerContext';
import { useSettings } from '../context/SettingsContext';
import { useSync } from '../context/SyncContext';
import { useTheme } from '../context/ThemeContext';
import { User } from '../models';
import { socketService } from '../services/socket';

interface SyncModalProps {
  visible: boolean;
  onClose: () => void;
}

const SyncModal: React.FC<SyncModalProps> = ({ visible, onClose }) => {
  const [users, setUsers] = useState<User[]>([]);
  const [selectedUserIds, setSelectedUserIds] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(false);
  const { user: currentUser } = useAuth();
  const { currentTrack, position, trackList, pause } = usePlayer();
  const { isSynced, sessionId } = useSync();
  const { colors } = useTheme();
  const { carLayoutMode } = useSettings();
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (visible) {
      fetchUsers();
    }
  }, [visible]);

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const res = await getUserList();
      if (res.code === 200) {
        setUsers(res.data.filter(u => u.id !== currentUser?.id));
      }
    } catch (e) {
      console.error("Failed to fetch users", e);
    } finally {
      setLoading(false);
    }
  };

  const toggleUser = (id: number) => {
    const newSelected = new Set(selectedUserIds);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedUserIds(newSelected);
  };

  const handleInvite = async () => {
    if (selectedUserIds.size === 0) return;
    
    // 发起邀请时先暂停，等待对方加入
    await pause();

    socketService.emit('invite', {
      targetUserIds: Array.from(selectedUserIds),
      currentTrack,
      playlist: trackList,
      progress: position,
      sessionId: sessionId || `sync_${currentUser?.id}_${Date.now()}`
    });
    
    onClose();
    setSelectedUserIds(new Set());
  };

  const renderItem = ({ item }: { item: User }) => (
    <TouchableOpacity 
      style={[styles.userItem, { borderBottomColor: colors.border }]} 
      onPress={() => toggleUser(item.id as number)}
    >
      <View style={[styles.avatar, { backgroundColor: colors.primary }]}>
        <Text style={[styles.avatarText, { color: colors.background }]}>{item.username[0].toUpperCase()}</Text>
      </View>
      <Text style={[styles.username, { color: colors.text }]}>{item.username}</Text>
      <View style={[
        styles.checkbox, 
        { borderColor: colors.border },
        selectedUserIds.has(item.id as number) && { backgroundColor: colors.primary, borderColor: colors.primary }
      ]}>
        {selectedUserIds.has(item.id as number) && <Ionicons name="checkmark" size={16} color={colors.background} />}
      </View>
    </TouchableOpacity>
  );

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <TouchableOpacity 
        style={[styles.overlay, carLayoutMode && styles.overlayCar]} 
        activeOpacity={1} 
        onPress={onClose}
      >
        <TouchableOpacity 
            style={[
              styles.content,
              carLayoutMode ? styles.contentCar : styles.contentDefault,
              {
                backgroundColor: colors.card,
                marginTop: carLayoutMode ? insets.top + 12 : 0,
                marginLeft: carLayoutMode ? 12 : 0,
              },
            ]} 
            activeOpacity={1}
            onPress={() => {}}
        >
          <View style={styles.header}>
            <Text style={[styles.title, { color: colors.text }]}>选择同步好友</Text>
            <TouchableOpacity onPress={onClose}>
              <Ionicons name="close" size={24} color={colors.secondary} />
            </TouchableOpacity>
          </View>

          {loading ? (
            <ActivityIndicator style={styles.loader} color={colors.primary} />
          ) : (
            <FlatList
              data={users}
              renderItem={renderItem}
              keyExtractor={item => item.id.toString()}
              style={styles.list}
              ListEmptyComponent={<Text style={[styles.empty, { color: colors.secondary }]}>暂无在线好友</Text>}
            />
          )}

          <TouchableOpacity 
            style={[
              styles.inviteButton, 
              { backgroundColor: colors.primary },
              selectedUserIds.size === 0 && { opacity: 0.5 }
            ]}
            disabled={selectedUserIds.size === 0}
            onPress={handleInvite}
          >
            <Text style={[styles.inviteButtonText, { color: colors.background }]}>
              发起同步 {selectedUserIds.size > 0 && `(${selectedUserIds.size})`}
            </Text>
          </TouchableOpacity>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  overlayCar: {
    justifyContent: 'flex-start',
    alignItems: 'flex-start',
  },
  content: {
    padding: 20,
    paddingBottom: 15
  },
  contentDefault: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    height: Dimensions.get('window').height * 0.6,
    width: '100%',
    maxWidth: 450,
  },
  contentCar: {
    borderRadius: 12,
    height: Dimensions.get('window').height * 0.6,
    width: Math.min(420, Dimensions.get('window').width - 24),
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  title: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  list: {
    flex: 1,
  },
  userItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  avatarText: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  username: {
    flex: 1,
    fontSize: 16,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkboxSelected: {
  },
  inviteButton: {
    padding: 15,
    borderRadius: 25,
    alignItems: 'center',
    marginTop: 20,
  },
  inviteButtonDisabled: {
  },
  inviteButtonText: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  loader: {
    flex: 1,
  },
  empty: {
    textAlign: 'center',
    marginTop: 40,
  },
});

export default SyncModal;
