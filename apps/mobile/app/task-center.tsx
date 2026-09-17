import { Ionicons } from "@expo/vector-icons";
import {
  TASK_CATEGORY_I18N_KEY,
  TASK_STATUS_I18N_KEY,
  UnifiedTask,
  UnifiedTaskStatus,
  TtsTask,
  deleteTtsTask,
  fetchAllTasks,
  isTaskActive,
  pauseTtsTask,
  resumeTtsTask,
} from "@soundx/services";
import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
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
import { useTheme } from "../src/context/ThemeContext";

type Filter = "all" | "active";

const STATUS_COLOR: Record<UnifiedTaskStatus, string> = {
  pending: "#13c2c2",
  processing: "#faad14",
  paused: "#8c8c8c",
  success: "#52c41a",
  failed: "#ff4d4f",
};

// 轮询策略：有进行中任务时 2s 高频刷新；没有时退到 30s 慢轮询（避免空跑打爆接口）
const ACTIVE_POLL_MS = 2000;
const IDLE_POLL_MS = 30000;

export default function TaskCenterScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { t } = useTranslation();
  const [tasks, setTasks] = useState<UnifiedTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const tasksRef = useRef<UnifiedTask[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchTasks = useCallback(async (showLoading = false) => {
    if (showLoading) setLoading(true);
    try {
      const list = await fetchAllTasks();
      tasksRef.current = list;
      setTasks(list);
    } catch (error) {
      console.error("Failed to fetch tasks:", error);
    } finally {
      if (showLoading) setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // 根据当前任务列表自适应调度下一次轮询
  const scheduleNext = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    const hasActive = tasksRef.current.some(isTaskActive);
    const delay = hasActive ? ACTIVE_POLL_MS : IDLE_POLL_MS;
    timerRef.current = setTimeout(async () => {
      await fetchTasks(false);
      scheduleNext();
    }, delay);
  }, [fetchTasks]);

  useEffect(() => {
    fetchTasks(true).then(() => scheduleNext());
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [fetchTasks, scheduleNext]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchTasks(false);
    scheduleNext();
  }, [fetchTasks, scheduleNext]);

  const handleTtsAction = async (
    action: "pause" | "resume" | "delete",
    id: string
  ) => {
    try {
      if (action === "delete") {
        Alert.alert(t("taskCenter.delete"), t("taskCenter.deleteConfirm"), [
          { text: t("taskCenter.all"), style: "cancel" },
          {
            text: t("taskCenter.delete"),
            style: "destructive",
            onPress: async () => {
              await deleteTtsTask(id);
              await fetchTasks(false);
              scheduleNext();
            },
          },
        ]);
      } else if (action === "pause") {
        await pauseTtsTask(id);
        await fetchTasks(false);
        scheduleNext();
      } else if (action === "resume") {
        await resumeTtsTask(id);
        await fetchTasks(false);
        scheduleNext();
      }
    } catch (error) {
      console.error(`Failed to ${action} task:`, error);
      Alert.alert(t("taskCenter.actionFailed"));
    }
  };

  const filteredTasks =
    filter === "all" ? tasks : tasks.filter(isTaskActive);

  const displayTitle = (item: UnifiedTask) =>
    item.source === "tts" && item.title
      ? item.title
      : t(TASK_CATEGORY_I18N_KEY[item.category]);

  const renderTask = ({ item }: { item: UnifiedTask }) => {
    const statusColor = STATUS_COLOR[item.status];
    const raw = item.raw as TtsTask;
    const isTts = item.source === "tts";
    return (
      <View
        style={[
          styles.taskCard,
          { backgroundColor: colors.card, borderColor: colors.border },
        ]}
      >
        <View style={styles.taskHeader}>
          <View style={{ flex: 1 }}>
            <Text
              style={[styles.bookName, { color: colors.text }]}
              numberOfLines={1}
            >
              {displayTitle(item)}
            </Text>
            <Text style={[styles.author, { color: colors.secondary }]}>
              {t(TASK_CATEGORY_I18N_KEY[item.category])}
              {item.subtitle ? ` · ${item.subtitle}` : ""}
            </Text>
          </View>
          <View
            style={[styles.statusTag, { backgroundColor: statusColor + "20" }]}
          >
            <Text style={[styles.statusText, { color: statusColor }]}>
              {t(TASK_STATUS_I18N_KEY[item.status])}
            </Text>
          </View>
        </View>

        <View style={styles.progressContainer}>
          <View
            style={[styles.progressBarFull, { backgroundColor: colors.border }]}
          >
            <View
              style={[
                styles.progressBarFill,
                { backgroundColor: statusColor, width: `${item.progress}%` },
              ]}
            />
          </View>
          <View style={styles.progressTextRow}>
            <Text style={[styles.progressCount, { color: colors.secondary }]}>
              {isTts
                ? `${raw.completed_chapters} / ${raw.total_chapters} ${t("taskCenter.chapters")}`
                : ""}
            </Text>
            <Text style={[styles.progressPercent, { color: colors.text }]}>
              {item.progress}%
            </Text>
          </View>
        </View>

        {isTts && (
          <>
            <View style={[styles.divider, { backgroundColor: colors.border }]} />
            <View style={styles.actionRow}>
              <Text style={[styles.time, { color: colors.secondary }]}>
                {item.createdAt
                  ? new Date(item.createdAt).toLocaleString()
                  : ""}
              </Text>
              <View style={styles.buttonGroup}>
                {item.status === "processing" && (
                  <TouchableOpacity
                    style={styles.actionButton}
                    onPress={() => handleTtsAction("pause", item.id)}
                  >
                    <Ionicons name="pause" size={20} color={colors.primary} />
                  </TouchableOpacity>
                )}
                {(item.status === "paused" ||
                  item.status === "failed" ||
                  item.status === "pending") && (
                  <TouchableOpacity
                    style={styles.actionButton}
                    onPress={() => handleTtsAction("resume", item.id)}
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
                  onPress={() => handleTtsAction("delete", item.id)}
                >
                  <Ionicons name="trash-outline" size={20} color="#ff4d4f" />
                </TouchableOpacity>
              </View>
            </View>
          </>
        )}
      </View>
    );
  };

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: colors.background, paddingTop: insets.top },
      ]}
    >
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => router.back()}
        >
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>
          {t("taskCenter.title")}
        </Text>
        <View style={{ width: 40 }} />
      </View>

      <View style={styles.filterContainer}>
        <FlatList
          horizontal
          showsHorizontalScrollIndicator={false}
          data={[
            { label: t("taskCenter.all"), value: "all" },
            { label: t("taskCenter.active"), value: "active" },
          ]}
          keyExtractor={(item) => item.value}
          contentContainerStyle={styles.filterList}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={[
                styles.filterItem,
                filter === item.value && { backgroundColor: colors.primary },
              ]}
              onPress={() => setFilter(item.value as Filter)}
            >
              <Text
                style={[
                  styles.filterText,
                  {
                    color:
                      filter === item.value
                        ? colors.background
                        : colors.secondary,
                  },
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
          keyExtractor={(item) => `${item.source}:${item.id}`}
          contentContainerStyle={styles.taskList}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.primary}
            />
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Ionicons
                name="document-text-outline"
                size={64}
                color={colors.border}
              />
              <Text style={[styles.emptyText, { color: colors.secondary }]}>
                {t("taskCenter.empty")}
              </Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    height: 56,
  },
  backButton: { padding: 8 },
  headerTitle: { fontSize: 18, fontWeight: "bold" },
  filterContainer: { paddingVertical: 12 },
  filterList: { paddingHorizontal: 16, gap: 8 },
  filterItem: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: "rgba(150,150,150,0.1)",
  },
  filterText: { fontSize: 14 },
  taskList: { padding: 16, paddingBottom: 40 },
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
  bookName: { fontSize: 18, fontWeight: "bold", marginBottom: 4 },
  author: { fontSize: 14 },
  statusTag: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  statusText: { fontSize: 12, fontWeight: "600" },
  progressContainer: { marginBottom: 4 },
  progressBarFull: {
    height: 6,
    borderRadius: 3,
    overflow: "hidden",
    marginBottom: 8,
  },
  progressBarFill: { height: "100%", borderRadius: 3 },
  progressTextRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  progressCount: { fontSize: 12 },
  progressPercent: { fontSize: 12, fontWeight: "600" },
  divider: { height: 1, marginVertical: 12 },
  actionRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  time: { fontSize: 12 },
  buttonGroup: { flexDirection: "row", gap: 12 },
  actionButton: { padding: 6 },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  emptyContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 100,
  },
  emptyText: { fontSize: 16, marginTop: 16, marginBottom: 24 },
});
