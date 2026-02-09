import { Ionicons } from "@expo/vector-icons";
import {
    createAdminUser,
    deleteAdminUser,
    getAdminUsers,
    getRegistrationSetting,
    setAdminUserExpiration,
    toggleRegistrationSetting,
} from "@soundx/services"; // Assuming these are exported
import { useFocusEffect, useRouter } from "expo-router";
import React, { useCallback, useState } from "react";
import {
    ActivityIndicator,
    Alert,
    FlatList,
    Modal,
    StyleSheet,
    Switch,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "../src/context/ThemeContext";
import { User } from "../src/models";

export default function AdminScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(false);
  const [registrationAllowed, setRegistrationAllowed] = useState(true);
  const [settingLoading, setSettingLoading] = useState(false);

  // modal states
  const [modalVisible, setModalVisible] = useState(false);
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [expirationDays, setExpirationDays] = useState<string>("");

  // create user states
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [isNewAdmin, setIsNewAdmin] = useState(false);

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const res = await getAdminUsers();
      if (res.code === 200) {
        setUsers(res.data);
      }
    } catch (error) {
      Alert.alert("Error", "Failed to load users");
    } finally {
      setLoading(false);
    }
  };

  const fetchSettings = async () => {
    setSettingLoading(true);
    try {
      const res = await getRegistrationSetting();
      if (res.code === 200) {
        setRegistrationAllowed(res.data);
      }
    } catch (error) {
      // ignore
    } finally {
      setSettingLoading(false);
    }
  };

  useFocusEffect(
    useCallback(() => {
      fetchUsers();
      fetchSettings();
    }, [])
  );

  const handleToggleRegistration = async (val: boolean) => {
    setSettingLoading(true); // crude optimistic update
    const res = await toggleRegistrationSetting(val);
    if (res.code === 200) {
      setRegistrationAllowed(val);
    } else {
      Alert.alert("Error", res.message);
    }
    setSettingLoading(false);
  };

  const handleDeleteUser = (id: number) => {
    Alert.alert(
      "确定删除",
      "确定删除该用户吗？删除之后数据无法恢复",
      [
        { text: "取消", style: "cancel" },
        {
          text: "删除",
          style: "destructive",
          onPress: async () => {
            const res = await deleteAdminUser(id);
            if (res.code === 200) {
              Alert.alert("成功", "用户删除成功");
              fetchUsers();
            } else {
              Alert.alert("失败", res.message);
            }
          },
        },
      ]
    );
  };

  const handleSetExpiration = async () => {
    if (!selectedUser) return;
    const days = expirationDays === "" ? null : parseInt(expirationDays);
    if (days !== null && isNaN(days)) {
      Alert.alert("Error", "Please enter a valid number");
      return;
    }

    const res = await setAdminUserExpiration(selectedUser.id, days);
    if (res.code === 200) {
      Alert.alert("Success", "Expiration updated");
      setModalVisible(false);
      fetchUsers();
      setExpirationDays("");
    } else {
      Alert.alert("Error", res.message);
    }
  };

  const handleCreateUser = async () => {
    if (!newUsername || !newPassword) {
      Alert.alert("Error", "Username and password are required");
      return;
    }

    const res = await createAdminUser({
      username: newUsername,
      password: newPassword,
      is_admin: isNewAdmin,
    });

    if (res.code === 200) {
      Alert.alert("Success", "User created");
      setCreateModalVisible(false);
      setNewUsername("");
      setNewPassword("");
      setIsNewAdmin(false);
      fetchUsers();
    } else {
      Alert.alert("Error", res.message);
    }
  };

  const formatDate = (dateStr?: string | Date | null) => {
    if (!dateStr) return "用不过期";
    const date = new Date(dateStr);
    return `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, "0")}-${date.getDate().toString().padStart(2, "0")}`;
  };

  const isExpired = (dateStr?: string | Date | null) => {
    if (!dateStr) return false;
    return new Date(dateStr).getTime() < Date.now();
  };

  const renderUserItem = ({ item }: { item: User }) => {
    const expired = isExpired(item.expiresAt);

    return (
      <View style={[styles.userItem, { borderBottomColor: colors.border }]}>
        <View style={styles.userInfo}>
          <Text style={[styles.username, { color: colors.text }]}>
            {item.username}
            {item.is_admin && (
              <Text style={{ color: colors.primary, fontWeight: "bold" }}>
                {" "}
                (管理员)
              </Text>
            )}
          </Text>
          <Text style={[styles.userDetails, { color: colors.secondary }]}>
            用户 ID: {item.id} | 注册时间: {formatDate(item.createdAt)}
          </Text>
          <Text
            style={[
              styles.userDetails,
              { color: expired ? "red" : colors.secondary },
            ]}
          >
            过期时间: {formatDate(item.expiresAt)}
          </Text>
        </View>
        {!item.is_admin && (
          <View style={styles.actions}>
            <TouchableOpacity
              style={[styles.actionButton, { backgroundColor: colors.primary }]}
              onPress={() => {
                setSelectedUser(item);
                setModalVisible(true);
              }}
            >
              <Ionicons name="time-outline" size={20} color={colors.background} />
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.actionButton,
                { backgroundColor: "red", marginLeft: 8 },
              ]}
              onPress={() => handleDeleteUser(item.id as unknown as number)}
            >
              <Ionicons name="trash-outline" size={20} color="#fff" />
            </TouchableOpacity>
          </View>
        )}
      </View>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View
        style={[
          styles.header,
          { paddingTop: insets.top + 10, borderBottomColor: colors.border },
        ]}
      >
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backButton}
        >
          <Ionicons name="chevron-back" size={28} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>
          用户管理
        </Text>
        <TouchableOpacity
          onPress={() => setCreateModalVisible(true)}
          style={styles.backButton}
        >
          <Ionicons name="add" size={28} color={colors.primary} />
        </TouchableOpacity>
      </View>

      <View
        style={[
          styles.settingRow,
          { borderBottomColor: colors.border, paddingHorizontal: 20 },
        ]}
      >
        <View style={{ flex: 1 }}>
          <Text style={[styles.settingLabel, { color: colors.text }]}>
            允许他人注册
          </Text>
        </View>
        <Switch
          value={registrationAllowed}
          onValueChange={handleToggleRegistration}
          trackColor={{ false: "#767577", true: colors.primary }}
        />
      </View>

      {loading ? (
        <ActivityIndicator
          size="large"
          color={colors.primary}
          style={{ marginTop: 20 }}
        />
      ) : (
        <FlatList
          data={users}
          renderItem={renderUserItem}
          keyExtractor={(item) => item.id.toString()}
          contentContainerStyle={{ paddingBottom: 40 }}
        />
      )}

      {/* Expiration Modal */}
      <Modal
        animationType="slide"
        transparent={true}
        visible={modalVisible}
        onRequestClose={() => setModalVisible(false)}
      >
        <View style={styles.centeredView}>
          <View
            style={[styles.modalView, { backgroundColor: colors.background }]}
          >
            <Text style={[styles.modalText, { color: colors.text }]}>
              设置过期时间 (天数)
            </Text>
            <Text style={[styles.modalDesc, { color: colors.secondary }]}>
              留空则永不过期。
            </Text>

            <TextInput
              style={[
                styles.input,
                { color: colors.text, borderColor: colors.border },
              ]}
              onChangeText={setExpirationDays}
              value={expirationDays}
              placeholder="e.g. 7, 30"
              placeholderTextColor={colors.secondary}
              keyboardType="numeric"
            />
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.button, styles.buttonClose, {backgroundColor: colors.background}]}
                onPress={() => setModalVisible(false)}
              >
                <Text style={[styles.textStyle, { color: colors.primary }]}>
                  取消
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.button, styles.buttonClose, {backgroundColor: colors.primary}]}
                onPress={handleSetExpiration}
              >
                <Text style={[styles.textStyle, { color: colors.background }]}>
                  保存
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Create User Modal */}
      <Modal
        animationType="slide"
        transparent={true}
        visible={createModalVisible}
        onRequestClose={() => setCreateModalVisible(false)}
      >
        <View style={styles.centeredView}>
          <View
            style={[styles.modalView, { backgroundColor: colors.background }]}
          >
            <Text style={[styles.modalText, { color: colors.text, marginBottom: 15 }]}>
              创建新用户
            </Text>

            <TextInput
              style={[
                styles.input,
                { color: colors.text, borderColor: colors.border },
              ]}
              onChangeText={setNewUsername}
              value={newUsername}
              placeholder="用户名"
              placeholderTextColor={colors.secondary}
              autoCapitalize="none"
            />
            <TextInput
              style={[
                styles.input,
                { color: colors.text, borderColor: colors.border },
              ]}
              onChangeText={setNewPassword}
              value={newPassword}
              placeholder="密码"
              placeholderTextColor={colors.secondary}
              secureTextEntry
            />

            <View style={[styles.settingRow, { width: '100%', marginVertical: 10, borderBottomWidth: 0 }]}>
                 <Text style={{color: colors.text, marginRight: 10}}>设为管理员</Text>
                 <Switch
                    value={isNewAdmin}
                    onValueChange={setIsNewAdmin}
                    trackColor={{ false: "#767577", true: colors.primary }}
                  />
            </View>

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.button, styles.buttonClose, {backgroundColor: colors.background}]}
                onPress={() => setCreateModalVisible(false)}
              >
                <Text style={[styles.textStyle, { color: colors.primary }]}>
                  取消
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.button, styles.buttonClose, {backgroundColor: colors.primary}]}
                onPress={handleCreateUser}
              >
                <Text style={[styles.textStyle, { color: colors.background }]}>
                  创建
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
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
    paddingHorizontal: 15,
    paddingBottom: 15,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: "bold",
  },
  backButton: {
    padding: 5,
  },
  settingRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 15,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  settingLabel: {
    fontSize: 16,
    fontWeight: "500",
  },
  userItem: {
    flexDirection: "row",
    padding: 15,
    borderBottomWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
  },
  userInfo: {
    flex: 1,
  },
  username: {
    fontSize: 16,
    fontWeight: "bold",
    marginBottom: 4,
  },
  userDetails: {
    fontSize: 12,
  },
  actions: {
    flexDirection: "row",
  },
  actionButton: {
    padding: 8,
    borderRadius: 8,
    justifyContent: "center",
    alignItems: "center",
  },
  centeredView: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.5)",
  },
  modalView: {
    margin: 20,
    borderRadius: 20,
    padding: 35,
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
    width: "80%",
  },
  button: {
    borderRadius: 20,

    padding: 10,
    elevation: 2,
    minWidth: 100,
    marginHorizontal: 10,
  },
  buttonClose: {
    opacity: 0.6,
  },
  textStyle: {
    fontWeight: "bold",
    textAlign: "center",
  },
  modalText: {
    marginBottom: 5,
    textAlign: "center",
    fontSize: 18,
    fontWeight: "bold",
  },
  modalDesc: {
    marginBottom: 15,
    textAlign: "center",
    fontSize: 12,
  },
  input: {
    height: 40,
    width: "100%",
    margin: 12,
    borderWidth: 1,
    padding: 10,
    borderRadius: 8,
  },
  modalActions: {
    flexDirection: "row",
    marginTop: 15,
  },
});
