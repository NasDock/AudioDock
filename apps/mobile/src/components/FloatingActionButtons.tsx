import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { FlatList, StyleSheet, TouchableOpacity, View } from "react-native";
import { useTheme } from "../context/ThemeContext";

interface FloatingActionButtonsProps {
  flatListRef: React.RefObject<FlatList<any> | null>;
  onLocateCurrent?: () => void;
  showLocate?: boolean;
  locateDisabled?: boolean;
  onToggleHeartbeatMode?: () => void;
  heartbeatModeActive?: boolean;
  showHeartbeatMode?: boolean;
}

export const FloatingActionButtons: React.FC<FloatingActionButtonsProps> = ({
  flatListRef,
  onLocateCurrent,
  showLocate = true,
  locateDisabled = false,
  onToggleHeartbeatMode,
  heartbeatModeActive = false,
  showHeartbeatMode = false,
}) => {
  const { colors } = useTheme();

  const scrollToTop = () => {
    flatListRef.current?.scrollToOffset({ offset: 0, animated: true });
  };

  const scrollToBottom = () => {
    flatListRef.current?.scrollToEnd({ animated: true });
  };

  const handleLocatePress = () => {
    if (!onLocateCurrent || locateDisabled) return;
    try {
      onLocateCurrent();
    } catch (error) {
      console.warn("[FloatingActionButtons] locate failed:", error);
    }
  };

  return (
    <View style={styles.container}>
      <TouchableOpacity
        style={[styles.button, { backgroundColor: colors.card }]}
        onPress={scrollToTop}
      >
        <Ionicons name="arrow-up" size={24} color={colors.primary} />
      </TouchableOpacity>

      {showLocate && onLocateCurrent && (
        <TouchableOpacity
          style={[
            styles.button,
            { backgroundColor: colors.card, opacity: locateDisabled ? 0.3 : 1 },
          ]}
          onPress={handleLocatePress}
          disabled={locateDisabled}
        >
          <Ionicons name="locate" size={24} color={colors.primary} />
        </TouchableOpacity>
      )}

      {showHeartbeatMode && onToggleHeartbeatMode && (
        <TouchableOpacity
          style={[
            styles.button,
            {
              backgroundColor: heartbeatModeActive
                ? colors.primary
                : colors.card,
            },
          ]}
          onPress={onToggleHeartbeatMode}
        >
          <Ionicons
            name={heartbeatModeActive ? "heart" : "heart-outline"}
            size={24}
            color={heartbeatModeActive ? colors.background : colors.primary}
          />
        </TouchableOpacity>
      )}

      <TouchableOpacity
        style={[styles.button, { backgroundColor: colors.card }]}
        onPress={scrollToBottom}
      >
        <Ionicons name="arrow-down" size={24} color={colors.primary} />
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    right: 20,
    bottom: 150,
    gap: 12,
    zIndex: 100,
  },
  button: {
    width: 38,
    height: 38,
    borderRadius: 19,
    justifyContent: "center",
    alignItems: "center",
    elevation: 5,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
  },
});
