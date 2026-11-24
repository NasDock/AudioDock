import { Ionicons } from "@expo/vector-icons";
import {
  getMiAuthStatus,
  getMiQRCode,
  getMiQRCodeStatus,
  logoutMiAccount,
  getMiKeywords,
  addMiKeyword,
  updateMiKeyword,
  deleteMiKeyword,
  getMiConversations,
  getMiCasts,
  type MiKeyword,
  type MiConversation,
  type MiCastRecord,
  type MiPagedResponse,
  TrackingEvent as TE,
  TrackingFeature as TF,
} from "@soundx/services";
import { initBaseURL } from "../src/https";
import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "../src/context/ThemeContext";
import { goBackOrReplace } from "../src/utils/navigation";
import { trackEvent } from "../src/services/tracking";

const PAGE_SIZE = 20;

// ===================== 登录状态 Tab =====================

interface LoginTabProps {
  onAuthChange: (loggedIn: boolean) => void;
}

const LoginTab: React.FC<LoginTabProps> = ({ onAuthChange }) => {
  const { t } = useTranslation();
  const { theme, colors } = useTheme();
  const onPrimaryColor = theme === "dark" ? "#000" : "#fff";
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);
  const [qrCodeUrl, setQrCodeUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  }, []);

  useEffect(() => {
    return stopPolling;
  }, [stopPolling]);

  // 把登录态同步给父组件 MiSpeakerScreen 以决定是否展示 tabBar
  useEffect(() => {
    if (loggedIn !== null) {
      onAuthChange(loggedIn);
    }
  }, [loggedIn, onAuthChange]);

  const checkStatus = useCallback(async () => {
    try {
      // 等待 baseURL 初始化完成（从 AsyncStorage 读取服务器地址）
      await initBaseURL();
      const res = await getMiAuthStatus();
      setLoggedIn(res.logged_in);
      if (res.logged_in) {
        setQrCodeUrl(null);
        stopPolling();
      }
    } catch {
      setLoggedIn(false);
    }
  }, [stopPolling]);

  useEffect(() => {
    checkStatus();
  }, [checkStatus]);

  const handleGetQRCode = async () => {
    setLoading(true);
    stopPolling();
    try {
      const res = await getMiQRCode();
      if (res.already_logged_in) {
        setLoggedIn(true);
        setQrCodeUrl(null);
        return;
      }
      if (res.qrcode_url) {
        setQrCodeUrl(res.qrcode_url);
        if (res.status_url) {
          pollingRef.current = setInterval(async () => {
            try {
              const statusRes = await getMiQRCodeStatus(res.status_url!);
              if (statusRes.status === "success") {
                stopPolling();
                setLoggedIn(true);
                setQrCodeUrl(null);
                Alert.alert(t("miManage.loginSuccess"));
              } else if (statusRes.status === "expired" || statusRes.status === "error") {
                stopPolling();
                setQrCodeUrl(null);
                Alert.alert(t("miManage.qrCodeExpired"));
              }
            } catch {
              // ignore polling errors
            }
          }, 3000);
        }
      }
    } catch (e: any) {
      Alert.alert(t("common.error"), e?.message || String(e));
    } finally {
      setLoading(false);
    }
  };

  if (loggedIn === null) {
    return (
      <View style={styles.centerBox}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  // 登录态下整个 LoginTab 会被父组件卸载（父组件根据 loggedIn 切换展示 3-tab 视图），
  // 这里只渲染"未登录 + 扫码登录"内容。

  return (
    <View style={styles.centerBox}>
      <Text style={[styles.secondaryText, { color: colors.secondary }]}>
        {t("miManage.notLoggedIn")}
      </Text>
      {qrCodeUrl ? (
        <>
          <Image
            source={{ uri: qrCodeUrl }}
            style={{ width: 200, height: 200, borderRadius: 8, marginVertical: 12 }}
          />
          <Text style={[styles.smallText, { color: colors.secondary }]}>
            {t("miManage.scanQRCode")}
          </Text>
        </>
      ) : (
        <TouchableOpacity
          style={[styles.primaryBtn, { backgroundColor: colors.primary }]}
          disabled={loading}
          onPress={handleGetQRCode}
        >
          {loading ? (
            <ActivityIndicator color={onPrimaryColor} />
          ) : (
            <Text style={[styles.primaryBtnText, { color: onPrimaryColor }]}>{t("miManage.getQRCode")}</Text>
          )}
        </TouchableOpacity>
      )}
    </View>
  );
};

// ===================== 唤醒关键字 Tab =====================

const KeywordsTab: React.FC = () => {
  const { t } = useTranslation();
  const { theme, colors } = useTheme();
  const onPrimaryColor = theme === "dark" ? "#000" : "#fff";
  const [keywords, setKeywords] = useState<MiKeyword[]>([]);
  const [loading, setLoading] = useState(true);
  const [newKeyword, setNewKeyword] = useState("");
  const [adding, setAdding] = useState(false);

  const loadKeywords = useCallback(async () => {
    try {
      // 确保 baseURL 已初始化
      await initBaseURL();
      const res = await getMiKeywords();
      setKeywords(res.keywords ?? []);
    } catch (e: any) {
      Alert.alert(t("common.error"), e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    loadKeywords();
  }, [loadKeywords]);

  const handleAdd = async () => {
    const kw = newKeyword.trim();
    if (!kw) return;
    setAdding(true);
    try {
      await addMiKeyword(kw);
      setNewKeyword("");
      await loadKeywords();
    } catch (e: any) {
      if (e?.response?.status === 409) {
        Alert.alert(t("miManage.keywordExists"));
      } else {
        Alert.alert(t("common.error"), e?.message || String(e));
      }
    } finally {
      setAdding(false);
    }
  };

  const handleToggle = async (kw: MiKeyword) => {
    const next = !kw.enabled;
    // 乐观更新：先切 UI，接口失败再回滚
    setKeywords((prev) =>
      prev.map((k) => (k.id === kw.id ? { ...k, enabled: next } : k)),
    );
    try {
      await updateMiKeyword(kw.id, { enabled: next });
    } catch (e: any) {
      // 回滚
      setKeywords((prev) =>
        prev.map((k) => (k.id === kw.id ? { ...k, enabled: !next } : k)),
      );
      Alert.alert(t("common.error"), e?.message || String(e));
    }
  };

  const handleDelete = (kw: MiKeyword) => {
    Alert.alert(
      t("miManage.keywordDeleteConfirm", { keyword: kw.keyword }),
      undefined,
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("common.delete"),
          style: "destructive",
          onPress: async () => {
            try {
              await deleteMiKeyword(kw.id);
              await loadKeywords();
            } catch (e: any) {
              Alert.alert(t("common.error"), e?.message || String(e));
            }
          },
        },
      ],
    );
  };

  if (loading) {
    return (
      <View style={styles.centerBox}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <View>
      <View style={[styles.addRow, { borderColor: colors.border }]}>
        <TextInput
          style={[
            styles.input,
            { borderColor: colors.border, backgroundColor: colors.card, color: colors.text, flex: 1 },
          ]}
          placeholder={t("miManage.keywordPlaceholder")}
          placeholderTextColor={colors.secondary}
          value={newKeyword}
          onChangeText={setNewKeyword}
          onSubmitEditing={handleAdd}
          returnKeyType="done"
        />
        <TouchableOpacity
          style={[styles.addBtn, { backgroundColor: colors.primary, marginLeft: 10 }]}
          disabled={adding}
          onPress={handleAdd}
        >
          {adding ? (
            <ActivityIndicator color={onPrimaryColor} size="small" />
          ) : (
            <Text style={[styles.primaryBtnText, { color: onPrimaryColor }]}>{t("miManage.keywordAdd")}</Text>
          )}
        </TouchableOpacity>
      </View>

      {keywords.length === 0 ? (
        <Text style={[styles.emptyText, { color: colors.secondary }]}>
          {t("miManage.keywordEmpty")}
        </Text>
      ) : (
        keywords.map((kw) => (
          <View
            key={kw.id}
            style={[styles.keywordRow, { borderBottomColor: colors.border }]}
          >
            <Text
              style={[
                { color: colors.text, fontSize: 15, flex: 1, fontWeight: kw.enabled ? "600" : "400" },
                !kw.enabled && { textDecorationLine: "line-through", opacity: 0.5 },
              ]}
            >
              {kw.keyword}
            </Text>
            <Switch
              value={kw.enabled}
              onValueChange={() => handleToggle(kw)}
              trackColor={{ false: "#767577", true: colors.primary }}
              thumbColor={"#f4f3f4"}
            />
            <TouchableOpacity
              onPress={() => handleDelete(kw)}
              style={{ padding: 4, marginLeft: 6 }}
            >
              <Ionicons name="trash-outline" size={20} color="#f5222d" />
            </TouchableOpacity>
          </View>
        ))
      )}
    </View>
  );
};

// ===================== 历史记录列表（对话/投放共用） =====================

interface HistoryListProps {
  fetcher: (q: { page: number; size: number }) => Promise<MiPagedResponse<any>>;
  renderItem: (item: any) => React.ReactElement;
}

const HistoryList: React.FC<HistoryListProps> = ({ fetcher, renderItem }) => {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const [items, setItems] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(
    async (p: number, append: boolean) => {
      if (p > 1) setLoadingMore(true);
      try {
        // 确保 baseURL 已初始化
        await initBaseURL();
        const res = await fetcher({ page: p, size: PAGE_SIZE });
        setTotal(res.total ?? 0);
        setItems((prev) => (append ? [...prev, ...(res.items ?? [])] : res.items ?? []));
        setPage(p);
      } catch (e: any) {
        Alert.alert(t("common.error"), e?.message || String(e));
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [fetcher, t],
  );

  useEffect(() => {
    load(1, false);
  }, [load]);

  const hasMore = items.length < total;

  return (
    <FlatList
      data={items}
      keyExtractor={(item) => String(item.id)}
      renderItem={({ item }) => renderItem(item)}
      style={{ flex: 1 }}
      contentContainerStyle={{ paddingBottom: 40 }}
      ListEmptyComponent={
        loading ? (
          <View style={styles.centerBox}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : (
          <Text style={[styles.emptyText, { color: colors.secondary }]}>
            {t("miManage.historyEmpty")}
          </Text>
        )
      }
      ListFooterComponent={
        items.length > 0 && hasMore ? (
          <TouchableOpacity
            style={{ paddingVertical: 14, alignItems: "center" }}
            disabled={loadingMore}
            onPress={() => load(page + 1, true)}
          >
            {loadingMore ? (
              <ActivityIndicator color={colors.primary} size="small" />
            ) : (
              <Text style={{ color: colors.primary }}>{t("miManage.loadMore")}</Text>
            )}
          </TouchableOpacity>
        ) : items.length > 0 ? (
          <Text
            style={{
              paddingVertical: 14,
              textAlign: "center",
              color: colors.secondary,
              fontSize: 12,
            }}
          >
            {t("miManage.noMore")}
          </Text>
        ) : null
      }
    />
  );
};

const ConversationsTab: React.FC = () => {
  const { t } = useTranslation();
  const { colors } = useTheme();

  const renderItem = (item: MiConversation) => (
    <View style={[styles.historyRow, { borderBottomColor: colors.border }]}>
      <Text style={{ color: colors.secondary, fontSize: 11, marginBottom: 4 }}>
        {new Date(item.timestamp_ms).toLocaleString()}
        {item.device_name ? ` · ${item.device_name}` : ""}
      </Text>
      <Text style={{ color: colors.text, fontSize: 15, fontWeight: "600" }}>
        {item.query}
      </Text>
      {!!item.answer && (
        <Text
          numberOfLines={2}
          style={{ color: colors.secondary, fontSize: 13, marginTop: 4 }}
        >
          {item.answer}
        </Text>
      )}
    </View>
  );

  return <HistoryList fetcher={getMiConversations} renderItem={renderItem} />;
};

const CastsTab: React.FC = () => {
  const { t } = useTranslation();
  const { colors } = useTheme();

  const sourceLabel = (source: string): string => {
    const map: Record<string, string> = {
      play_by_url: t("miManage.castSource_play_by_url"),
      play_playlist: t("miManage.castSource_play_playlist"),
      voice: t("miManage.castSource_voice"),
    };
    return map[source] ?? source;
  };

  const renderItem = (item: MiCastRecord) => (
    <View style={[styles.historyRow, { borderBottomColor: colors.border }]}>
      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
        <Text style={{ color: colors.secondary, fontSize: 11 }}>
          {new Date(item.created_at).toLocaleString()}
          {item.device_name ? ` · ${item.device_name}` : ""}
        </Text>
        <Text style={{ color: colors.primary, fontSize: 11 }}>
          {sourceLabel(item.source)}
        </Text>
      </View>
      <Text style={{ color: colors.text, fontSize: 15, fontWeight: "600", marginTop: 4 }}>
        {item.title || "-"}
      </Text>
      {item.tracks_count > 1 && (
        <Text style={{ color: colors.secondary, fontSize: 12, marginTop: 2 }}>
          {t("miManage.tracksCount", { count: item.tracks_count })}
        </Text>
      )}
    </View>
  );

  return <HistoryList fetcher={getMiCasts} renderItem={renderItem} />;
};

// ===================== 主页面 =====================

type MiTab = "keywords" | "conversations" | "casts";

const MiSpeakerScreen: React.FC = () => {
  const router = useRouter();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  // 未登录时整个页面只展示 LoginTab（不显示 tabBar）；登录后展示 keywords/conversations/casts 三个 tab。
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);
  const [activeTab, setActiveTab] = useState<MiTab>("keywords");

  const openedRef = useRef(false);
  useEffect(() => {
    if (openedRef.current) return;
    openedRef.current = true;
    trackEvent({ feature: TF.CAST, eventName: TE.CAST_OPEN });
  }, []);

  // 父组件主动发起首次登录态检查 —— 否则 loggedIn 永远停留在 null，
  // LoginTab 不会挂载（它只在 loggedIn === false 时渲染），页面一直 loading。
  const checkAuth = useCallback(async () => {
    try {
      await initBaseURL();
      const res = await getMiAuthStatus();
      setLoggedIn(res.logged_in);
    } catch {
      setLoggedIn(false);
    }
  }, []);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  const handleAuthChange = useCallback((v: boolean) => {
    setLoggedIn(v);
    if (v) setActiveTab("keywords");
  }, []);

  const handleLogout = useCallback(() => {
    Alert.alert(t("miManage.logoutConfirm"), undefined, [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("miManage.logout"),
        style: "destructive",
        onPress: async () => {
          try {
            await logoutMiAccount();
            setLoggedIn(false);
          } catch (e: any) {
            Alert.alert(t("common.error"), e?.message || String(e));
          }
        },
      },
    ]);
  }, [t]);

  if (loggedIn === null) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background, justifyContent: "center", alignItems: "center" }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (!loggedIn) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
          <TouchableOpacity
            onPress={() => goBackOrReplace(router, "/(tabs)/personal")}
            style={styles.backButton}
          >
            <Ionicons name="chevron-back" size={28} color={colors.text} />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: colors.text }]}>
            {t("miManage.title")}
          </Text>
          <View style={{ width: 40 }} />
        </View>
        <ScrollView contentContainerStyle={{ flexGrow: 1 }}>
          <LoginTab onAuthChange={handleAuthChange} />
        </ScrollView>
      </View>
    );
  }

  const tabs: { key: MiTab; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
    { key: "keywords", label: t("miManage.tabKeywords"), icon: "mic-outline" },
    { key: "conversations", label: t("miManage.tabConversations"), icon: "chatbubbles-outline" },
    { key: "casts", label: t("miManage.tabCasts"), icon: "radio-outline" },
  ];

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
        <TouchableOpacity
          onPress={() => goBackOrReplace(router, "/(tabs)/personal")}
          style={styles.backButton}
        >
          <Ionicons name="chevron-back" size={28} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>
          {t("miManage.title")}
        </Text>
        <TouchableOpacity onPress={handleLogout} style={{ padding: 5 }}>
          <Ionicons name="log-out-outline" size={24} color={colors.text} />
        </TouchableOpacity>
      </View>

      {/* Tab 栏 */}
      <View style={[styles.tabBar, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        {tabs.map((tab) => (
          <TouchableOpacity
            key={tab.key}
            style={[styles.tabItem, activeTab === tab.key && { borderBottomColor: colors.primary }]}
            onPress={() => setActiveTab(tab.key)}
          >
            <Text
              style={{
                fontSize: 13,
                fontWeight: activeTab === tab.key ? "700" : "400",
                color: activeTab === tab.key ? colors.primary : colors.secondary,
              }}
            >
              {tab.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={{ flex: 1 }}>
        {activeTab === "keywords" && (
          <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
            <KeywordsTab />
          </ScrollView>
        )}
        {activeTab === "conversations" && <ConversationsTab />}
        {activeTab === "casts" && <CastsTab />}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 15,
    paddingBottom: 15,
  },
  headerTitle: { fontSize: 20, fontWeight: "bold" },
  backButton: { padding: 5 },
  tabBar: {
    flexDirection: "row",
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 8,
  },
  tabItem: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 12,
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
  },
  scrollContent: { paddingHorizontal: 20, paddingTop: 14, paddingBottom: 40 },
  centerBox: { alignItems: "center", justifyContent: "center", paddingVertical: 60, gap: 14 },
  bigText: { fontSize: 17, fontWeight: "700" },
  secondaryText: { fontSize: 14 },
  smallText: { fontSize: 12 },
  primaryBtn: {
    paddingVertical: 12,
    paddingHorizontal: 32,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    minWidth: 120,
  },
  primaryBtnText: { fontSize: 15, fontWeight: "600" },
  addRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
  },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
  },
  addBtn: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  keywordRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  historyRow: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  emptyText: { textAlign: "center", marginTop: 40, fontSize: 14 },
});

export default MiSpeakerScreen;
