import { Ionicons } from "@expo/vector-icons";
import {
  deleteTtsTask,
  getTtsTasks,
  pauseTtsTask,
  resumeTtsTask,
  TtsTask,
} from "@soundx/services";
import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "../../src/context/ThemeContext";

type FilterStatus = "all" | "pending" | "processing" | "completed" | "paused" | "failed";

export default function TtsTaskListScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [tasks, setTasks] = useState<TtsTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filterStatus, setFilterStatus] = useState<FilterStatus>("all");

  const fetchTasks = useCallback(async (showLoading = false) => {
    if (showLoading) setLoading(true);
    try {
      const res = await getTtsTasks();
      setTasks(res.tasks);
    } catch (error) {
      console.error("Failed to fetch tasks:", error);
    } finally {
      if (showLoading) setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchTasks(true);
    const timer = setInterval(() => fetchTasks(false), 5000);
    return () => clearInterval(timer);
  }, [fetchTasks]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchTasks(false);
  }, [fetchTasks]);

  const handleAction = async (action: string, id: string) => {
    try {
      if (action === "delete") {
        Alert.alert("删除任务", "确定要删除这个 TTS 任务吗？", [
          { text: "取消", style: "cancel" },
          {
            text: "删除",
            style: "destructive",
            onPress: async () => {
              await deleteTtsTask(id);
              fetchTasks(false);
            },
          },
        ]);
      } else if (action === "pause") {
        await pauseTtsTask(id);
        fetchTasks(false);
      } else if (action === "resume") {
        await resumeTtsTask(id);
        fetchTasks(false);
      }
    } catch (error) {
      console.error(`Failed to ${action} task:`, error);
      Alert.alert("操作失败", "请稍后重试");
    }
  };

  const filteredTasks =
    filterStatus === "all"
      ? tasks
      : tasks.filter((t) => t.status === filterStatus);

  const getStatusColor = (status: string) => {
    switch (status) {
      case "completed":
        return "#52c41a";
      case "failed":
        return "#ff4d4f";
      case "processing":
        return "#faad14";
      case "paused":
        return "#8c8c8c";
      case "pending":
        return "#13c2c2";
      default:
        return colors.primary;
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case "completed":
        return "已完成";
      case "failed":
        return "失败";
      case "processing":
        return "处理中";
      case "paused":
        return "已暂停";
      case "pending":
        return "等待中";
      default:
        return status.toUpperCase();
    }
  };

  const renderTask = ({ item }: { item: TtsTask }) => {
    const percent =
      Math.round((item.completed_chapters / item.total_chapters) * 100) || 0;
    const statusColor = getStatusColor(item.status);

    return (
      <View style={[styles.taskCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.taskHeader}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.bookName, { color: colors.text }]} numberOfLines={1}>
              {item.book_name}
            </Text>
            <Text style={[styles.author, { color: colors.secondary }]}>
              {item.author}
            </Text>
          </View>
          <View style={[styles.statusTag, { backgroundColor: statusColor + "20" }]}>
            <Text style={[styles.statusText, { color: statusColor }]}>
              {getStatusText(item.status)}
            </Text>
          </View>
        </View>

        <View style={styles.progressContainer}>
          <View style={[styles.progressBarFull, { backgroundColor: colors.border }]}>
            <View
              style={[
                styles.progressBarFill,
                {
                  backgroundColor: statusColor,
                  width: `${percent}%`,
                },
              ]}
            />
          </View>
          <View style={styles.progressTextRow}>
            <Text style={[styles.progressCount, { color: colors.secondary }]}>
              {item.completed_chapters} / {item.total_chapters} 章节
            </Text>
            <Text style={[styles.progressPercent, { color: colors.text }]}>
              {percent}%
            </Text>
          </View>
        </View>

        <View style={[styles.divider, { backgroundColor: colors.border }]} />

        <View style={styles.actionRow}>
          <Text style={[styles.time, { color: colors.secondary }]}>
            {new Date(item.created_at).toLocaleDateString()} {new Date(item.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </Text>
          <View style={styles.buttonGroup}>
            {item.status === "processing" && (
              <TouchableOpacity
                style={styles.actionButton}
                onPress={() => handleAction("pause", item.id)}
              >
                <Ionicons name="pause" size={20} color={colors.primary} />
              </TouchableOpacity>
            )}
            {(item.status === "paused" ||
              item.status === "failed" ||
              item.status === "pending") && (
              <TouchableOpacity
                style={styles.actionButton}
                onPress={() => handleAction("resume", item.id)}
              >
                <Ionicons
                  name={item.status === "failed" ? "refresh" : "play"}
                  size={20}
                  color={colors.primary}
                />
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={styles.actionButton}
              onPress={() => handleAction("delete", item.id)}
            >
              <Ionicons name="trash-outline" size={20} color="#ff4d4f" />
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>TTS 任务列表</Text>
        <TouchableOpacity
          style={styles.createButton}
          onPress={() => router.push("/tts/create")}
        >
          <Ionicons name="add" size={28} color={colors.primary} />
        </TouchableOpacity>
      </View>

      <View style={styles.filterContainer}>
        <FlatList
          horizontal
          showsHorizontalScrollIndicator={false}
          data={[
            { label: "全部", value: "all" },
            { label: "等待中", value: "pending" },
            { label: "处理中", value: "processing" },
            { label: "已完成", value: "completed" },
            { label: "已暂停", value: "paused" },
            { label: "失败", value: "failed" },
          ]}
          keyExtractor={(item) => item.value}
          contentContainerStyle={styles.filterList}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={[
                styles.filterItem,
                filterStatus === item.value && { backgroundColor: colors.primary },
              ]}
              onPress={() => setFilterStatus(item.value as FilterStatus)}
            >
              <Text
                style={[
                  styles.filterText,
                  { color: filterStatus === item.value ? colors.background : colors.secondary },
                ]}
              >
                {item.label}
              </Text>
            </TouchableOpacity>
          )}
        />
      </View>

      {loading && !refreshing ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={filteredTasks}
          renderItem={renderTask}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.taskList}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Ionicons name="document-text-outline" size={64} color={colors.border} />
              <Text style={[styles.emptyText, { color: colors.secondary }]}>暂无转换任务</Text>
              <TouchableOpacity
                style={[styles.emptyButton, { backgroundColor: colors.primary }]}
                onPress={() => router.push("/tts/create")}
              >
                <Text style={[styles.emptyButtonText, { color: colors.background }]}>立即创建</Text>
              </TouchableOpacity>
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    height: 56,
  },
  backButton: {
    padding: 8,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "bold",
  },
  createButton: {
    padding: 8,
  },
  filterContainer: {
    paddingVertical: 12,
  },
  filterList: {
    paddingHorizontal: 16,
    gap: 8,
  },
  filterItem: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: "rgba(150,150,150,0.1)",
  },
  filterText: {
    fontSize: 14,
  },
  taskList: {
    padding: 16,
    paddingBottom: 40,
  },
  taskCard: {
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  taskHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 16,
  },
  bookName: {
    fontSize: 18,
    fontWeight: "bold",
    marginBottom: 4,
  },
  author: {
    fontSize: 14,
  },
  statusTag: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  statusText: {
    fontSize: 12,
    fontWeight: "600",
  },
  progressContainer: {
    marginBottom: 16,
  },
  progressBarFull: {
    height: 6,
    borderRadius: 3,
    overflow: "hidden",
    marginBottom: 8,
  },
  progressBarFill: {
    height: "100%",
    borderRadius: 3,
  },
  progressTextRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  progressCount: {
    fontSize: 12,
  },
  progressPercent: {
    fontSize: 12,
    fontWeight: "600",
  },
  divider: {
    height: 1,
    marginBottom: 12,
  },
  actionRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  time: {
    fontSize: 12,
  },
  buttonGroup: {
    flexDirection: "row",
    gap: 12,
  },
  actionButton: {
    padding: 6,
  },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  emptyContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 100,
  },
  emptyText: {
    fontSize: 16,
    marginTop: 16,
    marginBottom: 24,
  },
  emptyButton: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 24,
  },
  emptyButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "bold",
  },
});
