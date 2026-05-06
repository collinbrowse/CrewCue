import { useState, type ReactElement } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import { DSButton, DSCard, DSTextInput } from "../design-system";
import { useAuthedShell } from "../shell/AuthedShellContext";

const ROLE_CHOICES = ["Crew Member", "Crew Chief", "Pacer", "Logistics", "Other"] as const;

export function JoinRoomDetailsScreen(): ReactElement {
  const s = useAuthedShell();
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const [roomCode, setRoomCode] = useState((route.params as { roomCode?: string } | undefined)?.roomCode ?? "");
  const [displayName, setDisplayName] = useState("");
  const [selectedRole, setSelectedRole] = useState<(typeof ROLE_CHOICES)[number] | "">("");
  const [helpFocus, setHelpFocus] = useState("");
  const [localError, setLocalError] = useState<string | undefined>(undefined);
  const [showSuccess, setShowSuccess] = useState(false);
  const handleJoin = async () => {
    if (!roomCode.trim().match(/^\d{6}$/)) {
      setLocalError("Enter the 6-digit room code from your crew lead.");
      return;
    }
    if (!displayName.trim()) {
      setLocalError("Add your name so your crew can identify you.");
      return;
    }
    if (!selectedRole) {
      setLocalError("Select your role so the crew lead knows where you can help.");
      return;
    }

    setLocalError(undefined);
    const joined = await s.onJoinRoomByCode(roomCode.trim());
    if (!joined) {
      return;
    }

    setShowSuccess(true);
  };

  return (
    <ScrollView style={s.styles.container} contentContainerStyle={[s.styles.scroll, { paddingBottom: 32 }]}>
      <DSCard style={s.styles.card}>
        {!showSuccess ? (
          <>
            <Text style={s.styles.title}>Tell the crew about you</Text>
            <Text style={s.styles.subtitle}>Review your details before joining</Text>
            <DSCard style={[s.styles.summaryCard, styles.panelSpacing]}>
              <Text style={s.styles.summaryTitle}>Before you join</Text>
              <Text style={s.styles.body}>
                Share a few details so teammates can quickly understand your role when coordinating race-day operations.
              </Text>
              <View style={styles.fieldWrap}>
                <Text style={styles.fieldLabel}>Room code</Text>
                <DSTextInput
                  value={roomCode}
                  onChangeText={setRoomCode}
                  autoCapitalize="none"
                  keyboardType="number-pad"
                  maxLength={6}
                  placeholder="6-digit code"
                />
              </View>
              <View style={styles.fieldWrap}>
                <Text style={styles.fieldLabel}>Your name</Text>
                <DSTextInput
                  value={displayName}
                  onChangeText={setDisplayName}
                  autoCapitalize="words"
                  placeholder="Alex Johnson"
                />
              </View>
              <View style={styles.fieldWrap}>
                <Text style={styles.fieldLabel}>Your role</Text>
                <View style={styles.rolePills}>
                  {ROLE_CHOICES.map((role) => {
                    const selected = selectedRole === role;
                    return (
                      <Pressable
                        key={role}
                        onPress={() => setSelectedRole(role)}
                        style={[styles.rolePill, selected ? styles.rolePillActive : null]}
                      >
                        <Text style={[styles.rolePillLabel, selected ? styles.rolePillLabelActive : null]}>{role}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
              <View style={styles.fieldWrap}>
                <Text style={styles.fieldLabel}>How you are helping (optional)</Text>
                <DSTextInput
                  value={helpFocus}
                  onChangeText={setHelpFocus}
                  autoCapitalize="sentences"
                  placeholder="Aid station support from miles 18-24"
                />
              </View>
              {localError ? <Text style={styles.errorText}>{localError}</Text> : null}
              <View style={styles.actionWrap}>
                <DSButton preset="primary" disabled={s.busy} onPress={() => void handleJoin()}>
                  {s.busy ? "Joining race room..." : "Join race room"}
                </DSButton>
                <DSButton preset="secondary" onPress={() => navigation.goBack()}>
                  Back
                </DSButton>
              </View>
            </DSCard>
          </>
        ) : (
          <DSCard style={s.styles.summaryCard}>
            <View style={styles.successArtWrap}>
              <View style={[styles.confettiDot, styles.dotTopLeft]} />
              <View style={[styles.confettiDot, styles.dotTopRight]} />
              <View style={[styles.confettiDot, styles.dotBottomLeft]} />
              <View style={styles.successOuterCircle}>
                <View style={styles.successInnerCircle}>
                  <Text style={styles.successCheck}>✓</Text>
                </View>
              </View>
            </View>
            <Text style={styles.successTitle}>You are in!</Text>
            <Text style={styles.successBody}>
              {displayName.trim()} joined as {selectedRole}. Head back to the map to review race details with your crew.
            </Text>
            <View style={styles.actionWrap}>
              <DSButton preset="primary" onPress={() => navigation.goBack()}>
                Done
              </DSButton>
            </View>
          </DSCard>
        )}
      </DSCard>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  panelSpacing: {
    marginTop: 12
  },
  fieldWrap: {
    marginTop: 12,
    gap: 6
  },
  fieldLabel: {
    color: "#5c5a54",
    fontSize: 13,
    fontWeight: "700"
  },
  rolePills: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8
  },
  rolePill: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#d8d1c4",
    backgroundColor: "#ffffff",
    paddingHorizontal: 12,
    paddingVertical: 8
  },
  rolePillActive: {
    backgroundColor: "rgba(107,70,193,0.14)",
    borderColor: "#6B46C1"
  },
  rolePillLabel: {
    color: "#5c5a54",
    fontSize: 13,
    fontWeight: "700"
  },
  rolePillLabelActive: {
    color: "#6B46C1"
  },
  errorText: {
    marginTop: 12,
    color: "#991b1b",
    backgroundColor: "#fef2f2",
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8
  },
  actionWrap: {
    marginTop: 14,
    gap: 8
  },
  successArtWrap: {
    alignItems: "center",
    justifyContent: "center",
    marginTop: 6,
    marginBottom: 12
  },
  successOuterCircle: {
    width: 132,
    height: 132,
    borderRadius: 66,
    backgroundColor: "rgba(34,197,94,0.2)",
    alignItems: "center",
    justifyContent: "center"
  },
  successInnerCircle: {
    width: 94,
    height: 94,
    borderRadius: 47,
    backgroundColor: "#6B46C1",
    alignItems: "center",
    justifyContent: "center"
  },
  successCheck: {
    color: "#ffffff",
    fontSize: 44,
    fontWeight: "900"
  },
  confettiDot: {
    position: "absolute",
    width: 12,
    height: 12,
    borderRadius: 6
  },
  dotTopLeft: {
    top: 8,
    left: "24%",
    backgroundColor: "#d6bcfa"
  },
  dotTopRight: {
    top: 10,
    right: "23%",
    backgroundColor: "#c4b5fd"
  },
  dotBottomLeft: {
    bottom: 18,
    left: "18%",
    backgroundColor: "#8b5cf6"
  },
  successTitle: {
    color: "#111827",
    fontSize: 30,
    fontWeight: "800",
    textAlign: "center"
  },
  successBody: {
    color: "#5c5a54",
    fontSize: 16,
    textAlign: "center",
    lineHeight: 24,
    marginTop: 10
  }
});
