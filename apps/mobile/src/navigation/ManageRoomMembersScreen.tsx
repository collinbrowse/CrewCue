import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, useColorScheme, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { Role } from "@crewcue/contracts";
import { DSButton, DSCard, DSTextInput, useDSTheme } from "../design-system";
import { useAuthedShell } from "../shell/AuthedShellContext";
import type { MapStackParamList, ProfileStackParamList } from "./types";

const ROLE_OPTIONS: Role[] = ["athlete", "crew_member", "crew_chief", "team_manager"];

export function ManageRoomMembersScreen(): ReactElement {
  const s = useAuthedShell();
  const theme = useDSTheme();
  const colorScheme = useColorScheme();
  const navigation = useNavigation<
    NativeStackNavigationProp<MapStackParamList | ProfileStackParamList, "ManageRoomMembers" | "ProfileManageRoomMembers">
  >();
  const [selectedRoles, setSelectedRoles] = useState<Record<string, Role>>({});
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<Role>("crew_member");

  const room = s.room;
  const isOwner = Boolean(room && s.auth.claims?.sub && room.athleteId === s.auth.claims.sub);

  /** Depend on `room`, not `room.memberships` — same array ref can hide new `displayName` on members. */
  const memberships = useMemo(() => room?.memberships ?? [], [room]);
  const pendingInvites = useMemo(() => (s.invites ?? []).filter((invite) => invite.status === "pending"), [s.invites]);

  const [editingMyName, setEditingMyName] = useState(false);
  const [inlineNameDraft, setInlineNameDraft] = useState("");
  /** Shown for your row until `room` reflects the saved name (avoids a flash back to "You"). */
  const [optimisticSelfRosterName, setOptimisticSelfRosterName] = useState<string | null>(null);
  const nameInputRef = useRef<TextInput>(null);

  /** Primary roster label plus optional "(you)" when this row is the signed-in member (including race owner). */
  const memberLabels = useMemo(() => {
    const output: Record<string, { primary: string; showYouTag: boolean }> = {};
    if (!room) {
      return output;
    }
    const sub = s.auth.claims?.sub;
    let crewCounter = 1;
    for (const member of memberships) {
      const isSelf = Boolean(sub && member.userId === sub);
      let primary: string;
      if (isSelf) {
        const ownName = s.auth.claims?.email?.split("@")[0]?.replace(/[._-]+/g, " ").trim();
        primary =
          optimisticSelfRosterName?.trim() ||
          member.displayName?.trim() ||
          (member.userId === room.athleteId ? room.creatorName?.trim() ?? "" : "") ||
          (ownName ? toTitleCase(ownName) : "") ||
          (member.userId === room.athleteId ? "Race owner" : "You");
      } else if (member.userId === room.athleteId) {
        primary = member.displayName?.trim() || room.creatorName?.trim() || "Race owner";
      } else {
        const dn = member.displayName?.trim();
        if (dn) {
          primary = dn;
        } else {
          primary = `Crew member ${crewCounter}`;
          crewCounter += 1;
        }
      }
      const showYouTag = isSelf && primary !== "You";
      output[member.userId] = { primary, showYouTag };
    }
    return output;
  }, [memberships, optimisticSelfRosterName, room, s.auth.claims?.email, s.auth.claims?.sub]);

  const commitInlineName = useCallback(async () => {
    const trimmed = inlineNameDraft.trim();
    if (!trimmed || s.busy) {
      return;
    }
    try {
      await s.onUpdateMyRosterDisplayName(trimmed);
      setOptimisticSelfRosterName(trimmed);
    } catch {
      /* Error is surfaced via shell `apiError` / status from App.tsx */
    } finally {
      setEditingMyName(false);
      setInlineNameDraft("");
    }
  }, [inlineNameDraft, s.busy, s.onUpdateMyRosterDisplayName]);

  useLayoutEffect(() => {
    if (!editingMyName) {
      return;
    }
    const id = requestAnimationFrame(() => {
      nameInputRef.current?.focus();
    });
    return () => cancelAnimationFrame(id);
  }, [editingMyName]);

  useLayoutEffect(() => {
    navigation.setOptions({
      title: room?.name?.trim() || "Race",
      headerRight: () => null
    });
  }, [navigation, room?.name]);

  useEffect(() => {
    const unsub = navigation.addListener("blur", () => {
      setEditingMyName(false);
      setInlineNameDraft("");
      // Do not clear optimistic roster name here — keyboard dismiss / focus changes can emit
      // `blur` on some stacks and would wipe the label before `room` catches up.
    });
    return unsub;
  }, [navigation]);

  useEffect(() => {
    setOptimisticSelfRosterName(null);
  }, [room?.id]);

  const cx = useMemo(() => {
    const isLight = colorScheme === "light";
    return {
      headerCard: {
        backgroundColor: isLight ? "rgba(107,70,193,0.12)" : "rgba(107,70,193,0.22)",
        borderColor: isLight ? "#c9b8ed" : "#6B46C1"
      },
      headerTitle: { color: theme.color.text },
      headerBody: { color: theme.color.body },
      memberId: { color: theme.color.text },
      memberMeta: { color: theme.color.muted },
      rolePill: {
        borderColor: theme.color.border,
        backgroundColor: theme.color.secondaryButton
      },
      rolePillActive: {
        borderColor: theme.color.authAccent,
        backgroundColor: isLight ? "rgba(107,70,193,0.14)" : "rgba(107,70,193,0.28)"
      },
      rolePillLabel: { color: theme.color.body },
      rolePillLabelActive: { color: theme.color.authAccent },
      inviteRow: { borderTopColor: theme.color.divider }
    };
  }, [colorScheme, theme]);

  if (!room) {
    return (
      <ScrollView style={s.styles.container} contentContainerStyle={s.styles.scroll}>
        <DSCard style={s.styles.card}>
          <Text style={s.styles.title}>Manage room members</Text>
          <Text style={s.styles.body}>Select a race room first, then return here to manage your team.</Text>
        </DSCard>
      </ScrollView>
    );
  }

  return (
    <ScrollView style={s.styles.container} contentContainerStyle={[s.styles.scroll, { paddingBottom: 30 }]}>
      <DSCard style={s.styles.card}>
        <Text style={s.styles.title}>Room members</Text>
        <DSCard style={[s.styles.summaryCard, styles.headerCard, cx.headerCard]}>
          <Text style={[styles.headerTitle, cx.headerTitle]}>{isOwner ? "Membership controls" : "Roster view"}</Text>
          <Text style={[styles.headerBody, cx.headerBody]}>
            {isOwner
              ? "Update member roles, remove people, and send new invites from this page."
              : "Only the race owner can make changes. You can view members and roles here."}
          </Text>
        </DSCard>

        {memberships.map((member) => {
          const selectedRole = selectedRoles[member.userId] ?? member.role;
          const isCurrentUser = member.userId === s.auth.claims?.sub;
          const isRoomOwner = member.userId === room.athleteId;
          const label = memberLabels[member.userId] ?? { primary: "Crew member", showYouTag: false };
          const showInlineEdit = isCurrentUser && editingMyName;

          return (
            <DSCard key={member.userId} style={[s.styles.summaryCard, styles.memberCard]}>
              <View style={styles.memberNameRow}>
                {showInlineEdit ? (
                  <TextInput
                    ref={nameInputRef}
                    value={inlineNameDraft}
                    onChangeText={setInlineNameDraft}
                    placeholder="Your name"
                    placeholderTextColor={theme.color.muted}
                    autoCapitalize="words"
                    returnKeyType="done"
                    blurOnSubmit={false}
                    onSubmitEditing={() => void commitInlineName()}
                    editable={!s.busy}
                    style={[
                      styles.inlineNameInput,
                      {
                        color: theme.color.text,
                        borderColor: theme.color.border,
                        backgroundColor: theme.color.summaryCard
                      }
                    ]}
                  />
                ) : (
                  <Text style={[styles.memberId, cx.memberId, styles.memberNameText]}>
                    {label.primary}
                    {label.showYouTag ? (
                      <Text style={[styles.memberYouTag, { color: theme.color.muted }]}> (you)</Text>
                    ) : null}
                  </Text>
                )}
                {isCurrentUser && !showInlineEdit ? (
                  <Pressable
                    hitSlop={10}
                    disabled={s.busy}
                    accessibilityRole="button"
                    accessibilityLabel="Edit your roster name"
                    onPress={() => {
                      setInlineNameDraft("");
                      setEditingMyName(true);
                    }}
                    style={styles.inlineEditIconHit}
                  >
                    <Text style={[styles.inlineEditGlyph, { color: theme.color.primary }]}>✎</Text>
                  </Pressable>
                ) : null}
                {isCurrentUser && showInlineEdit ? (
                  <Pressable
                    hitSlop={10}
                    disabled={s.busy || !inlineNameDraft.trim()}
                    accessibilityRole="button"
                    accessibilityLabel="Save roster name"
                    onPress={() => void commitInlineName()}
                    style={styles.inlineEditIconHit}
                  >
                    <Text
                      style={[
                        styles.inlineEditGlyph,
                        { color: !inlineNameDraft.trim() ? theme.color.muted : theme.color.primary }
                      ]}
                    >
                      ✓
                    </Text>
                  </Pressable>
                ) : null}
              </View>
              <Text style={[styles.memberMeta, cx.memberMeta]}>
                Joined {new Date(member.joinedAt).toLocaleDateString()} {isRoomOwner ? "• Owner" : ""}
              </Text>
              {isOwner ? (
                <View style={styles.roleRow}>
                  {ROLE_OPTIONS.map((role) => {
                    const active = role === selectedRole;
                    return (
                      <Pressable
                        key={`${member.userId}-${role}`}
                        onPress={() => setSelectedRoles((prev) => ({ ...prev, [member.userId]: role }))}
                        style={[styles.rolePill, cx.rolePill, active ? [styles.rolePillActive, cx.rolePillActive] : null]}
                      >
                        <Text
                          style={[styles.rolePillLabel, cx.rolePillLabel, active ? cx.rolePillLabelActive : null]}
                        >
                          {role}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              ) : (
                <View style={styles.roleReadOnlyWrap}>
                  <Text style={styles.roleReadOnlyLabel}>Role</Text>
                  <Text style={styles.roleReadOnlyValue}>{member.role}</Text>
                </View>
              )}
              {isOwner ? (
                <View style={styles.actionsRow}>
                  <View style={{ flex: 1 }}>
                    <DSButton
                      preset="secondary"
                      disabled={s.busy || selectedRole === member.role}
                      onPress={() => void s.onUpdateMemberRole(member.userId, selectedRole)}
                    >
                      Save role
                    </DSButton>
                  </View>
                  <View style={{ flex: 1 }}>
                    <DSButton
                      preset="danger"
                      disabled={s.busy || isCurrentUser || isRoomOwner}
                      onPress={() => void s.onRemoveMember(member.userId)}
                    >
                      Remove
                    </DSButton>
                  </View>
                </View>
              ) : null}
            </DSCard>
          );
        })}

        {isOwner ? (
          <DSCard style={[s.styles.summaryCard, styles.memberCard]}>
            <Text style={[styles.headerTitle, cx.headerTitle]}>Invite new member</Text>
            <Text style={[styles.headerBody, cx.headerBody]}>
              Send an invitation and pre-assign the role they should receive.
            </Text>
            <View style={{ marginTop: 10 }}>
              <DSTextInput
                value={inviteEmail}
                onChangeText={setInviteEmail}
                autoCapitalize="none"
                keyboardType="email-address"
                placeholder="crew@team.com"
              />
            </View>
            <View style={styles.roleRow}>
              {ROLE_OPTIONS.map((role) => {
                const active = inviteRole === role;
                return (
                  <Pressable
                    key={`invite-${role}`}
                    onPress={() => setInviteRole(role)}
                    style={[styles.rolePill, cx.rolePill, active ? [styles.rolePillActive, cx.rolePillActive] : null]}
                  >
                    <Text style={[styles.rolePillLabel, cx.rolePillLabel, active ? cx.rolePillLabelActive : null]}>
                      {role}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <View style={{ marginTop: 10 }}>
              <DSButton
                preset="primary"
                disabled={s.busy || !inviteEmail.trim()}
                onPress={() => {
                  void s.onIssueInvite({ email: inviteEmail.trim(), role: inviteRole }).then(() => setInviteEmail(""));
                }}
              >
                Send invite
              </DSButton>
            </View>
          </DSCard>
        ) : null}

        <DSCard style={[s.styles.summaryCard, styles.memberCard]}>
          <Text style={[styles.headerTitle, cx.headerTitle]}>Outstanding invites</Text>
          {pendingInvites.length === 0 ? (
            <Text style={[styles.headerBody, cx.headerBody]}>No pending invites.</Text>
          ) : (
            pendingInvites.map((invite) => (
              <View key={invite.token} style={[styles.inviteRow, cx.inviteRow]}>
                <Text style={[styles.memberId, cx.memberId]}>{invite.email}</Text>
                <Text style={[styles.memberMeta, cx.memberMeta]}>
                  {invite.role} • expires {new Date(invite.expiresAt).toLocaleDateString()}
                </Text>
              </View>
            ))
          )}
        </DSCard>
      </DSCard>
    </ScrollView>
  );
}

function toTitleCase(value: string): string {
  return value
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

const styles = StyleSheet.create({
  headerCard: {
    marginTop: 10,
    borderWidth: 1
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "700"
  },
  headerBody: {
    marginTop: 8,
    lineHeight: 22
  },
  memberCard: {
    marginTop: 12
  },
  memberId: {
    fontSize: 16,
    fontWeight: "700"
  },
  memberNameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8
  },
  memberNameText: {
    flex: 1,
    flexShrink: 1
  },
  inlineNameInput: {
    flex: 1,
    minWidth: 0,
    fontSize: 16,
    fontWeight: "700",
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6
  },
  inlineEditIconHit: {
    paddingHorizontal: 4,
    paddingVertical: 2,
    justifyContent: "center",
    alignItems: "center"
  },
  inlineEditGlyph: {
    fontSize: 20,
    fontWeight: "700"
  },
  memberYouTag: {
    fontSize: 16,
    fontWeight: "600"
  },
  memberMeta: {
    marginTop: 6
  },
  roleRow: {
    marginTop: 10,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8
  },
  rolePill: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 7
  },
  rolePillActive: {
    borderWidth: 1
  },
  rolePillLabel: {
    fontWeight: "700",
    fontSize: 12
  },
  actionsRow: {
    marginTop: 12,
    flexDirection: "row",
    gap: 8
  },
  inviteRow: {
    marginTop: 10,
    borderTopWidth: 1,
    paddingTop: 10
  },
  roleReadOnlyWrap: {
    marginTop: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#d8d1c4",
    backgroundColor: "#ffffff",
    paddingHorizontal: 10,
    paddingVertical: 8
  },
  roleReadOnlyLabel: {
    color: "#7a756c",
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 0.5
  },
  roleReadOnlyValue: {
    color: "#111827",
    marginTop: 4,
    fontWeight: "700"
  }
});
