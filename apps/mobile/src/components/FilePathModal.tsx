import { useTheme } from "@/src/context/ThemeContext";
import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { Modal, Pressable, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

interface FilePathModalProps {
  visible: boolean;
  title?: string;
  path?: string | null;
  onClose: () => void;
}

export const FilePathModal: React.FC<FilePathModalProps> = ({
  visible,
  title = "文件路径",
  path,
  onClose,
}) => {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const displayPath = path?.trim() || "暂无文件路径";

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          style={{ width: "100%", maxWidth: 450, alignSelf: "center" }}
          onPress={(e) => e.stopPropagation()}
        >
          <View
            style={[
              styles.content,
              { backgroundColor: colors.card, paddingBottom: insets.bottom + 20 },
            ]}
          >
            <View style={styles.handle} />
            <View style={styles.header}>
              <Ionicons name="document-text-outline" size={20} color={colors.text} />
              <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>
                {title}
              </Text>
            </View>
            <Text style={[styles.path, { color: colors.secondary }]} selectable>
              {displayPath}
            </Text>
            <TouchableOpacity
              style={[styles.button, { borderColor: colors.border }]}
              onPress={onClose}
            >
              <Text style={[styles.buttonText, { color: colors.text }]}>关闭</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "flex-end",
    alignItems: "center",
  },
  content: {
    width: "100%",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    alignSelf: "center",
    marginBottom: 16,
    backgroundColor: "rgba(150,150,150,0.3)",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 10,
  },
  title: {
    fontSize: 18,
    fontWeight: "600",
    flex: 1,
  },
  path: {
    fontSize: 13,
    lineHeight: 20,
    marginBottom: 16,
  },
  button: {
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
  },
  buttonText: {
    fontSize: 15,
    fontWeight: "500",
  },
});
