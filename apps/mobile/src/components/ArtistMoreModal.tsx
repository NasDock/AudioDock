import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { Modal, Pressable, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "../context/ThemeContext";
import { Artist } from "../models";

interface ArtistMoreModalProps {
  visible: boolean;
  artist: Artist | null;
  onClose: () => void;
  onUpdateCover: () => void;
}

export const ArtistMoreModal: React.FC<ArtistMoreModalProps> = ({
  visible,
  artist,
  onClose,
  onUpdateCover,
}) => {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  if (!artist) return null;

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
              styles.modalContent,
              { backgroundColor: colors.card, paddingBottom: insets.bottom + 20 },
            ]}
          >
            <View style={styles.handle} />
            <Text style={[styles.title, { color: colors.text }]}>艺人选项</Text>
            <Text style={[styles.artistName, { color: colors.secondary }]}>{artist.name}</Text>

            <TouchableOpacity
              style={styles.option}
              onPress={() => {
                onClose();
                onUpdateCover();
              }}
            >
              <Ionicons name="image-outline" size={24} color={colors.text} />
              <Text style={[styles.optionText, { color: colors.text }]}>修改封面</Text>
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
  },
  artistName: {
    fontSize: 14,
    paddingHorizontal: 20,
    marginBottom: 12,
  },
  option: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 16,
    paddingHorizontal: 20,
    borderBottomWidth: 0.5,
    borderBottomColor: "rgba(150,150,150,0.1)",
  },
  optionText: {
    fontSize: 16,
    marginLeft: 16,
  },
});
