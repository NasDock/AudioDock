import { AntDesign, Ionicons, MaterialIcons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useState } from "react";
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "../src/context/ThemeContext";

export default function MemberBenefitsScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [selectedPlan, setSelectedPlan] = useState<'annual' | 'lifetime'>('lifetime');

  const handlePayment = (method: string) => {
    const planName = selectedPlan === 'lifetime' ? '永久卡' : '年卡';
    const amount = selectedPlan === 'lifetime' ? 60 : 20;
    Alert.alert("赞助确认", `正在唤起${method === 'wechat' ? '微信' : '支付宝'}支付\n方案: ${planName}\n金额: ¥${amount}\n\n支付功能开发中，感谢支持！`);
  };

  const comparisonData = [
    { feature: '基础功能', free: true, member: true },
    { feature: '设备接力', free: true, member: true },
    { feature: '同步控制', free: false, member: true },
    { feature: 'TTS语言朗读', free: false, member: true },
    { feature: '数据源备份', free: false, member: true },
  ];

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <View style={styles.header}>
         <TouchableOpacity 
           onPress={() => router.back()} 
           style={styles.backButton}
         >
            <MaterialIcons name="arrow-back" size={24} color={colors.text} />
         </TouchableOpacity>
         <Text style={[styles.headerTitle, { color: colors.text }]}>会员权益</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Comparison Table */}
        <View style={[styles.tableCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.tableHeader}>
                <Text style={[styles.tableHeaderText, { flex: 2, color: colors.secondary }]}>权益功能</Text>
                <Text style={[styles.tableHeaderText, { flex: 1, textAlign: 'center', color: colors.secondary }]}>非会员</Text>
                <Text style={[styles.tableHeaderText, { flex: 1, textAlign: 'center', color: colors.secondary }]}>会员</Text>
            </View>
            {comparisonData.map((item, index) => (
                <View key={index} style={[styles.tableRow, { borderTopWidth: index === 0 ? 0 : 0.5, borderTopColor: colors.border }]}>
                    <Text style={[styles.featureText, { flex: 2, color: colors.text }]}>{item.feature}</Text>
                    <View style={{ flex: 1, alignItems: 'center' }}>
                        <Ionicons 
                            name={item.free ? "checkmark-circle" : "close-circle"} 
                            size={20} 
                            color={item.free ? colors.primary : colors.secondary} 
                            style={{ opacity: item.free ? 1 : 0.3 }}
                        />
                    </View>
                    <View style={{ flex: 1, alignItems: 'center' }}>
                        <Ionicons 
                            name="checkmark-circle" 
                            size={22} 
                            color="#FFD700" 
                        />
                    </View>
                </View>
            ))}
        </View>

        {/* Pricing Plans */}
         <View style={styles.dividerContainer}>
            <Text style={[styles.dividerText, { color: colors.secondary }]}>会员方案</Text>
        </View>


        <View style={styles.plansContainer}>
            <TouchableOpacity 
              style={[
                styles.planCard, 
                { backgroundColor: colors.card, borderColor: selectedPlan === 'annual' ? colors.primary : colors.border },
                selectedPlan === 'annual' && { borderWidth: 2 }
              ]}
              onPress={() => setSelectedPlan('annual')}
            >
                <Text style={[styles.planName, { color: colors.text }]}>年卡</Text>
                <View style={styles.priceContainer}>
                    <Text style={[styles.currency, { color: colors.primary }]}>¥</Text>
                    <Text style={[styles.priceAmount, { color: colors.primary }]}>20</Text>
                    <Text style={[styles.unit, { color: colors.secondary }]}>/年</Text>
                </View>
            </TouchableOpacity>

            <TouchableOpacity 
              style={[
                styles.planCard, 
                { backgroundColor: colors.card, borderColor: selectedPlan === 'lifetime' ? "#FFD700" : colors.border },
                selectedPlan === 'lifetime' && { borderWidth: 2 }
              ]}
              onPress={() => setSelectedPlan('lifetime')}
            >
                <View style={[styles.recommendBadge, { opacity: selectedPlan === 'lifetime' ? 1 : 0.6 }]}>
                    <Text style={styles.recommendText}>推荐</Text>
                </View>
                <Text style={[styles.planName, { color: colors.text }]}>永久卡</Text>
                <View style={styles.priceContainer}>
                    <Text style={[styles.currency, { color: colors.primary }]}>¥</Text>
                    <Text style={[styles.priceAmount, { color: colors.primary }]}>60</Text>
                    <Text style={[styles.unit, { color: colors.secondary }]}>/永久</Text>
                </View>
            </TouchableOpacity>
        </View>


        {/* Payment Methods */}
        <View style={styles.dividerContainer}>
            <Text style={[styles.dividerText, { color: colors.secondary }]}>支付方式</Text>
        </View>

        <View style={styles.paymentMethods}>
            <TouchableOpacity 
              style={[styles.paymentItem, { backgroundColor: colors.card, borderColor: colors.border }]}
              onPress={() => handlePayment('wechat')}
            >
                <AntDesign name="wechat" size={24} color={'#1AAD19'} />
                <Text style={[styles.paymentText, { color: colors.text }]}>微信</Text>
            </TouchableOpacity>
            <TouchableOpacity 
              style={[styles.paymentItem, { backgroundColor: colors.card, borderColor: colors.border }]}
              onPress={() => handlePayment('alipay')}
            >
                <AntDesign name="alipay-circle" size={24} color={'#02A9F1'} />
                <Text style={[styles.paymentText, { color: colors.text }]}>支付宝</Text>
            </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  backButton: {
    padding: 8,
    marginRight: 16,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 40,
  },
  tableCard: {
    borderRadius: 16,
    borderWidth: 1,
    paddingVertical: 10,
    overflow: 'hidden',
  },
  tableHeader: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  tableHeaderText: {
    fontSize: 12,
    fontWeight: '600',
  },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  featureText: {
    fontSize: 14,
    fontWeight: '500',
  },
  sectionTitleContainer: {
    alignItems: 'center',
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  plansContainer: {
    flexDirection: 'row',
    gap: 15,
  },
  planCard: {
    flex: 1,
    borderRadius: 16,
    borderWidth: 1,
    padding: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  planName: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 8,
  },
  priceContainer: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  currency: {
    fontSize: 14,
    fontWeight: 'bold',
  },
  priceAmount: {
    fontSize: 28,
    fontWeight: 'bold',
    marginHorizontal: 2,
  },
  unit: {
    fontSize: 12,
  },
  recommendBadge: {
    position: 'absolute',
    top: 0,
    right: 0,
    backgroundColor: '#FFD700',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderTopRightRadius: 14,
    borderBottomLeftRadius: 10,
    zIndex: 1,
  },
  recommendText: {
    color: '#000',
    fontSize: 10,
    fontWeight: 'bold',
  },
  dividerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 20,
  },
  dividerLine: {
    flex: 1,
    height: 1,
  },
  dividerText: {
    marginHorizontal: 0,
    fontSize: 12,
  },
  paymentMethods: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 15,
  },
  paymentItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.05)',
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 5,
    elevation: 2,
    flex: 1,
    justifyContent: 'center',
  },
  paymentText: {
    fontSize: 14,
    fontWeight: '600',
  },
  footerText: {
    textAlign: 'center',
    marginTop: 40,
    fontSize: 11,
    lineHeight: 18,
    paddingHorizontal: 20,
  },
});
