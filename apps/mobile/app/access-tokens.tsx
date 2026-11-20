import { Ionicons } from "@expo/vector-icons";
import {
  createAccessToken,
  deleteAccessToken,
  getAccessTokens,
  updateAccessToken,
  type AccessToken,
} from "@soundx/services";
import * as Clipboard from "expo-clipboard";
import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import Modal from "react-native-modal";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "../src/context/ThemeContext";
import { goBackOrReplace } from "../src/utils/navigation";

const formatTime = (value?: string | Date | null) => {
  if (!value) return "";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export default function AccessTokensScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, theme } = useTheme();
  const { t } = useTranslation();

  const [tokens, setTokens] = useState<AccessToken[]>([]);
  const [loading, setLoading] = useState(false);
  // 名称输入弹窗复用：mode=create 创建 / mode=rename 重命名
  const [nameModal, setNameModal] = useState<{
    mode: "create" | "rename";
    target?: AccessToken;
  } | null>(null);
  const [nameInput, setNameInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  /** 创建成功后展示的完整令牌（仅此一次可见） */
  const [createdToken, setCreatedToken] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getAccessTokens();
      if (res.code === 200) {
        setTokens(res.data || []);
      } else {
        Alert.alert(t("common.error"), res.message);
      }
    } catch (error) {
      console.error("Failed to load access tokens", error);
      Alert.alert(t("common.error"), t("accessTokenManagement.fetchFailed"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const openCreate = () => {
    setNameInput("");
    setNameModal({ mode: "create" });
  };

  const openRename = (token: AccessToken) => {
    setNameInput(token.name);
    setNameModal({ mode: "rename", target: token });
  };

  const handleSubmitName = async () => {
    const name = nameInput.trim();
    if (!name || !nameModal) return;
    setSubmitting(true);
    try {
      if (nameModal.mode === "create") {
        const res = await createAccessToken(name);
        if (res.code === 200) {
          setNameModal(null);
          setCreatedToken(res.data.token);
          void load();
        } else {
          Alert.alert(t("common.error"), res.message);
        }
      } else if (nameModal.target) {
        const res = await updateAccessToken(nameModal.target.id, { name });
        if (res.code === 200) {
          setNameModal(null);
          void load();
        } else {
          Alert.alert(t("common.error"), res.message);
        }
      }
    } catch (error) {
      console.error("Submit access token name failed", error);
      Alert.alert(t("common.error"), t("common.error"));
    } finally {
      setSubmitting(false);
    }
  };

  const handleCopy = async () => {
    if (!createdToken) return;
    try {
      await Clipboard.setStringAsync(createdToken);
      Alert.alert(t("accessTokenManagement.copySuccess"));
    } catch {
      Alert.alert(t("common.error"), t("accessTokenManagement.copyFailed"));
    }
  };

  const handleToggle = async (token: AccessToken, enabled: boolean) => {
    try {
      const res = await updateAccessToken(token.id, { enabled });
      if (res.code === 200) {
        void load();
      } else {
        Alert.alert(t("common.error"), res.message);
      }
    } catch (error) {
      console.error("Toggle access token failed", error);
      Alert.alert(t("common.error"), t("common.error"));
    }
  };

  const handleDelete = (token: AccessToken) => {
    Alert.alert(
      t("accessTokenManagement.deleteConfirmTitle"),
      t("accessTokenManagement.deleteConfirmContent", { name: token.name }),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("common.delete"),
          style: "destructive",
          onPress: async () => {
            try {
              const res = await deleteAccessToken(token.id);
              if (res.code === 200) {
                void load();
              } else {
                Alert.alert(t("common.error"), res.message);
              }
            } catch (error) {
              console.error("Delete access token failed", error);
              Alert.alert(t("common.error"), t("common.error"));
            }
          },
        },
      ],
    );
  };

  const confirmColor = theme === "dark" ? "#000" : "#fff";

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
        <TouchableOpacity
          onPress={() => goBackOrReplace(router, "/settings")}
          style={styles.backButton}
        >
          <Ionicons name="chevron-back" size={28} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>
          {t("accessTokenManagement.title")}
        </Text>
        <TouchableOpacity onPress={load} style={styles.backButton}>
          {loading ? (
            <ActivityIndicator size="small" color={colors.secondary} />
          ) : (
            <Ionicons name="refresh" size={22} color={colors.secondary} />
          )}
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={[styles.description, { color: colors.secondary }]}>
          {t("accessTokenManagement.description")}
        </Text>

        {!loading && tokens.length === 0 ? (
          <View style={[styles.emptyCard, { borderColor: colors.border }]}>
            <Text style={[styles.emptyText, { color: colors.secondary }]}>
              {t("common.noData")}
            </Text>
          </View>
        ) : (
          tokens.map((token) => (
            <View
              key={token.id}
              style={[
                styles.card,
                { backgroundColor: colors.card, borderColor: colors.border },
              ]}
            >
              <View style={styles.cardHeader}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[styles.cardTitle, { color: colors.text }]}>
                    {token.name}
                  </Text>
                  <Text
                    style={[styles.cardSubtitle, { color: colors.secondary }]}
                    numberOfLines={1}
                  >
                    {token.tokenPrefix}…
                  </Text>
                </View>
                <Switch
                  value={token.enabled}
                  onValueChange={(val) => handleToggle(token, val)}
                  trackColor={{ false: "#767577", true: colors.primary }}
                  thumbColor="#f4f3f4"
                />
              </View>

              <View style={styles.metaRow}>
                <Text style={[styles.metaText, { color: colors.secondary }]}>
                  {t("accessTokenManagement.lastUsedAt")}:{" "}
                  {token.lastUsedAt
                    ? formatTime(token.lastUsedAt)
                    : t("accessTokenManagement.neverUsed")}
                </Text>
                <Text style={[styles.metaText, { color: colors.secondary }]}>
                  {t("accessTokenManagement.createdAt")}:{" "}
                  {formatTime(token.createdAt) || "-"}
                </Text>
              </View>

              <View style={styles.actionRow}>
                <TouchableOpacity
                  style={[styles.actionButton, { borderColor: colors.primary }]}
                  onPress={() => openRename(token)}
                >
                  <Text
                    style={[styles.actionButtonText, { color: colors.primary }]}
                  >
                    {t("accessTokenManagement.rename")}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.actionButton, { borderColor: "#FF3B30" }]}
                  onPress={() => handleDelete(token)}
                >
                  <Text style={[styles.actionButtonText, { color: "#FF3B30" }]}>
                    {t("common.delete")}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          ))
        )}

        <TouchableOpacity
          style={[
            styles.addButton,
            { borderColor: colors.primary, backgroundColor: colors.card },
          ]}
          onPress={openCreate}
        >
          <Ionicons name="add-circle-outline" size={18} color={colors.primary} />
          <Text style={[styles.addButtonText, { color: colors.primary }]}>
            {t("accessTokenManagement.create")}
          </Text>
        </TouchableOpacity>
      </ScrollView>

      {/* 创建 / 重命名 名称输入弹窗 */}
      <Modal
        isVisible={!!nameModal}
        onBackdropPress={() => setNameModal(null)}
        onBackButtonPress={() => setNameModal(null)}
        useNativeDriver
        hideModalContentWhileAnimating
        animationIn="fadeIn"
        animationOut="fadeOut"
        backdropTransitionOutTiming={0}
        style={styles.centeredModal}
      >
        <View style={styles.modalOverlay}>
          <View
            style={[styles.modalContent, { backgroundColor: colors.card }]}
          >
            <Text style={[styles.modalTitle, { color: colors.text }]}>
              {nameModal?.mode === "create"
                ? t("accessTokenManagement.createTitle")
                : t("accessTokenManagement.renameTitle")}
            </Text>
            <TextInput
              style={[
                styles.modalInput,
                {
                  color: colors.text,
                  borderColor: colors.border,
                  backgroundColor: colors.background,
                },
              ]}
              placeholder={t("accessTokenManagement.namePlaceholder")}
              placeholderTextColor={colors.secondary}
              value={nameInput}
              onChangeText={setNameInput}
              autoFocus
            />
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => setNameModal(null)}
              >
                <Text style={{ color: colors.secondary }}>
                  {t("common.cancel")}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.modalConfirmBtn,
                  { backgroundColor: colors.primary },
                ]}
                onPress={handleSubmitName}
                disabled={submitting || !nameInput.trim()}
              >
                {submitting ? (
                  <ActivityIndicator size="small" color={confirmColor} />
                ) : (
                  <Text
                    style={[styles.modalConfirmText, { color: confirmColor }]}
                  >
                    {t("common.confirm")}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* 创建成功：完整令牌仅此一次展示 */}
      <Modal
        isVisible={!!createdToken}
        useNativeDriver
        hideModalContentWhileAnimating
        animationIn="fadeIn"
        animationOut="fadeOut"
        backdropTransitionOutTiming={0}
        style={styles.centeredModal}
      >
        <View style={styles.modalOverlay}>
          <View
            style={[styles.modalContent, { backgroundColor: colors.card }]}
          >
            <Text style={[styles.modalTitle, { color: colors.text }]}>
              {t("accessTokenManagement.createdTitle")}
            </Text>
            <Text style={[styles.createdHint, { color: colors.secondary }]}>
              {t("accessTokenManagement.createdHint")}
            </Text>
            <View
              style={[
                styles.tokenBox,
                {
                  borderColor: colors.border,
                  backgroundColor: colors.background,
                },
              ]}
            >
              <Text
                selectable
                style={[styles.tokenText, { color: colors.text }]}
              >
                {createdToken}
              </Text>
            </View>
            <TouchableOpacity
              style={[styles.copyButton, { borderColor: colors.primary }]}
              onPress={handleCopy}
            >
              <Ionicons name="copy-outline" size={16} color={colors.primary} />
              <Text style={[styles.addButtonText, { color: colors.primary }]}>
                {t("accessTokenManagement.copy")}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.modalConfirmBtn,
                styles.doneButton,
                { backgroundColor: colors.primary },
              ]}
              onPress={() => setCreatedToken(null)}
            >
              <Text style={[styles.modalConfirmText, { color: confirmColor }]}>
                {t("accessTokenManagement.createdDone")}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 15,
    paddingBottom: 10,
  },
  headerTitle: { fontSize: 18, fontWeight: "bold" },
  backButton: { padding: 5, width: 40, alignItems: "center" },
  scrollContent: { padding: 15, gap: 12, paddingBottom: 60 },
  description: { fontSize: 13, lineHeight: 18 },
  emptyCard: {
    padding: 24,
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: "dashed",
    alignItems: "center",
  },
  emptyText: { fontSize: 14, textAlign: "center" },
  card: { padding: 12, borderRadius: 12, borderWidth: 1, gap: 8 },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  cardTitle: { fontSize: 16, fontWeight: "600" },
  cardSubtitle: { fontSize: 12, marginTop: 2, fontFamily: "Menlo" },
  metaRow: { gap: 2 },
  metaText: { fontSize: 12 },
  actionRow: { flexDirection: "row", gap: 8, marginTop: 4 },
  actionButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
  },
  actionButtonText: { fontSize: 12, fontWeight: "600" },
  addButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: "dashed",
    gap: 8,
  },
  addButtonText: { fontSize: 14, fontWeight: "600" },
  centeredModal: { justifyContent: "center", margin: 0 },
  modalOverlay: { paddingHorizontal: 32 },
  modalContent: { borderRadius: 16, padding: 20 },
  modalTitle: { fontSize: 17, fontWeight: "600", marginBottom: 12 },
  modalInput: {
    height: 44,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    fontSize: 15,
  },
  modalButtons: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 12,
    marginTop: 16,
  },
  modalCancelBtn: { paddingHorizontal: 16, paddingVertical: 10 },
  modalConfirmBtn: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  modalConfirmText: { fontSize: 15, fontWeight: "600" },
  createdHint: { fontSize: 13, lineHeight: 18, marginBottom: 12 },
  tokenBox: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
  },
  tokenText: { fontSize: 13, fontFamily: "Menlo" },
  copyButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 12,
  },
  doneButton: { alignSelf: "stretch" },
});
