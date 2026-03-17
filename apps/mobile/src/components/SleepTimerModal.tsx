import { usePlayer } from "@/src/context/PlayerContext";
import { useTheme } from "@/src/context/ThemeContext";
import { useAuth } from "@/src/context/AuthContext";
import { trackEvent } from "@/src/services/tracking";
import { Ionicons } from "@expo/vector-icons";
import React from "react";
import {
    Modal,
    Pressable,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

interface SleepTimerModalProps {
  visible: boolean;
  onClose: () => void;
}

const SleepTimerModal: React.FC<SleepTimerModalProps> = ({
  visible,
  onClose,
}) => {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { setSleepTimer, clearSleepTimer, sleepTimer } = usePlayer();
  const { user, device } = useAuth();

  const timeOptions = [15, 20, 30, 45, 60, 120];

  const handleSelectTime = (minutes: number) => {
    setSleepTimer(minutes);
    trackEvent({
      feature: "player",
      eventName: "sleep_timer_set",
      userId: user?.id ? String(user.id) : undefined,
      deviceId: device?.id ? String(device.id) : undefined,
      value: minutes,
    });
    onClose();
  };

  const handleClear = () => {
    clearSleepTimer();
    onClose();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable 
          style={{ width: "100%", maxWidth: 450, alignSelf: 'center' }} 
          onPress={(e) => e.stopPropagation()}
        >
          <View
            style={[
              styles.modalContent,
              { backgroundColor: colors.card, paddingBottom: insets.bottom },
            ]}
          >
            <View style={styles.handle} />
            <Text style={[styles.title, { color: colors.text }]}>定时关闭</Text>

            {sleepTimer && (
              <TouchableOpacity
                style={[styles.option, { borderBottomColor: colors.border }]}
                onPress={handleClear}
              >
                <Ionicons name="close-circle-outline" size={24} color={colors.primary} />
                <Text style={[styles.optionText, { color: colors.primary }]}>
                  取消定时
                </Text>
              </TouchableOpacity>
            )}

            {timeOptions.map((minutes) => (
              <TouchableOpacity
                key={minutes}
                style={[styles.option, { borderBottomColor: colors.border }]}
                onPress={() => handleSelectTime(minutes)}
              >
                <Ionicons name="time-outline" size={24} color={colors.text} />
                <Text style={[styles.optionText, { color: colors.text }]}>
                  {minutes} 分钟后
                </Text>
                <Ionicons name="chevron-forward" size={20} color={colors.secondary} />
              </TouchableOpacity>
            ))}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
};

export default SleepTimerModal;

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "flex-end",
    alignItems: 'center',
  },
  modalContent: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 8,
  },
  handle: {
    width: 40,
    height: 4,
    backgroundColor: "rgba(150,150,150,0.3)",
    borderRadius: 2,
    alignSelf: "center",
    marginBottom: 16,
  },
  title: {
    fontSize: 18,
    fontWeight: "600",
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  option: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 16,
    paddingHorizontal: 20,
    borderBottomWidth: 0.5,
  },
  optionText: {
    fontSize: 16,
    flex: 1,
    marginLeft: 16,
  },
});
