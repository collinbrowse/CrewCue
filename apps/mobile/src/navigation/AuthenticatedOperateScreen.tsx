import { useEffect, useMemo, useState, type ReactElement } from "react";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { ScrollView, Share, Text, View } from "react-native";
import { DSButton, DSCard, DSTextInput } from "../design-system";
import { useAuthedShell } from "../shell/AuthedShellContext";
import type { OperateStackParamList } from "./types";

export function AuthenticatedOperateScreen(): ReactElement {
  const s = useAuthedShell();
  const navigation = useNavigation<NativeStackNavigationProp<OperateStackParamList, "OperateHome">>();
  const inRace = Boolean(s.room && s.raceProfile?.setupComplete);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"crew_member" | "crew_chief" | "team_manager">("crew_member");

  useEffect(() => {
    if (!s.room) {
      return;
    }
    void s.onFetchRoomDetails();
    void s.onFetchInvites();
  }, [s.room?.id]);

  const canIssueInvite = Boolean(s.roomDetail?.permissions?.canIssueInvite);
  const inviteDisabledReason = useMemo(() => {
    if (!s.room) {
      return "Finish race setup first to create your crew room.";
    }
    if (canIssueInvite) {
      return undefined;
    }
    return "Only athlete, crew chief, or team manager can send invites for this room.";
  }, [canIssueInvite, s.room]);

  return (
    <ScrollView
      style={s.styles.container}
      contentContainerStyle={s.styles.scroll}
      keyboardShouldPersistTaps="handled"
    >
      <DSCard style={s.styles.card}>
        <Text style={s.styles.title}>CrewCue</Text>
        <Text style={s.styles.subtitle}>Race operations control center</Text>
        <DSCard style={s.styles.summaryCard}>
          <Text style={s.styles.summaryTitle}>{inRace ? "You are in your race" : "Start your race setup"}</Text>
          <Text style={s.styles.body}>
            {inRace
              ? "Review race details, update your route, and share the crew link so everyone sees the same plan."
              : "Set up race details, optionally upload GPX, and share your crew link from one planning flow."}
          </Text>
        </DSCard>

        <DSCard style={[s.styles.summaryCard, { marginTop: 12 }]}>
          <Text style={s.styles.summaryTitle}>Race details</Text>
          {inRace ? (
            <>
              <Text style={s.styles.body}>Race name: {s.raceProfile?.raceName || s.room?.name}</Text>
              <Text style={s.styles.body}>
                Crew name: {s.raceProfile?.crewName?.trim() ? s.raceProfile.crewName : "Not set"}
              </Text>
              <Text style={s.styles.body}>
                Description: {s.raceProfile?.raceDescription?.trim() ? s.raceProfile.raceDescription : "Not set"}
              </Text>
              <Text style={s.styles.body}>Course uploaded: {s.room?.course ? "Yes" : "No"}</Text>
            </>
          ) : (
            <Text style={s.styles.body}>
              You are not in a race yet. Tap Start planning your race to create your race and optional setup details.
            </Text>
          )}
        </DSCard>

        <View style={{ marginTop: 12, flexDirection: "row", gap: 8 }}>
          <View style={{ flex: 1 }}>
            <DSButton preset="primary" onPress={() => navigation.navigate("RacePlanning")}>
              Start planning your race
            </DSButton>
          </View>
        </View>

        {inRace ? (
          <View style={{ marginTop: 12, flexDirection: "row", gap: 8 }}>
            <View style={{ flex: 1 }}>
              <DSButton
                preset="secondary"
                onPress={() => {
                  if (!s.room) return;
                  const shareLink = `crewcue://join?roomId=${encodeURIComponent(s.room.id)}`;
                  void Share.share({ message: `Join my CrewCue race room: ${shareLink}` });
                }}
              >
                Share crew link
              </DSButton>
            </View>
          </View>
        ) : null}

        <DSCard style={[s.styles.summaryCard, { marginTop: 12 }]}>
          <Text style={s.styles.summaryTitle}>Crew and invites</Text>
          <Text style={s.styles.body}>
            Create invites in-app and keep membership status visible for demo handoff.
          </Text>
          <View style={{ marginTop: 10 }}>
            <Text style={s.styles.label}>Invite email</Text>
            <View style={{ marginTop: 6 }}>
              <DSTextInput
                value={inviteEmail}
                onChangeText={setInviteEmail}
                autoCapitalize="none"
                keyboardType="email-address"
                placeholder="crew@example.com"
              />
            </View>
            <View style={{ marginTop: 8, flexDirection: "row", gap: 8 }}>
              <View style={{ flex: 1 }}>
                <DSButton
                  preset="secondary"
                  onPress={() => setInviteRole("crew_member")}
                  disabled={inviteRole === "crew_member"}
                >
                  Crew member
                </DSButton>
              </View>
              <View style={{ flex: 1 }}>
                <DSButton
                  preset="secondary"
                  onPress={() => setInviteRole("crew_chief")}
                  disabled={inviteRole === "crew_chief"}
                >
                  Crew chief
                </DSButton>
              </View>
              <View style={{ flex: 1 }}>
                <DSButton
                  preset="secondary"
                  onPress={() => setInviteRole("team_manager")}
                  disabled={inviteRole === "team_manager"}
                >
                  Team manager
                </DSButton>
              </View>
            </View>
            <View style={{ marginTop: 8 }}>
              <DSButton
                preset="primary"
                disabled={!canIssueInvite || !inviteEmail.includes("@") || s.busy}
                onPress={() => {
                  void s.onIssueInvite({ email: inviteEmail, role: inviteRole }).then(() => setInviteEmail(""));
                }}
              >
                Send invite
              </DSButton>
            </View>
            <View style={{ marginTop: 8 }}>
              <DSButton
                preset="secondary"
                disabled={!s.room || s.busy}
                onPress={() => {
                  void s.onFetchInvites();
                  void s.onFetchRoomDetails();
                }}
              >
                Refresh crew status
              </DSButton>
            </View>
            {inviteDisabledReason ? <Text style={[s.styles.body, { marginTop: 8 }]}>{inviteDisabledReason}</Text> : null}
          </View>

          <View style={{ marginTop: 12 }}>
            <Text style={s.styles.label}>Pending invites</Text>
            {s.invites && s.invites.length > 0 ? (
              s.invites.map((invite) => (
                <Text key={invite.token} style={s.styles.body}>
                  {invite.email} - {invite.role.replace("_", " ")} ({invite.status})
                </Text>
              ))
            ) : (
              <Text style={s.styles.body}>No invites yet.</Text>
            )}
          </View>
          <View style={{ marginTop: 10 }}>
            <Text style={s.styles.label}>Current crew members</Text>
            {s.room?.memberships.length ? (
              s.room.memberships.map((member) => (
                <Text key={`${member.userId}-${member.joinedAt}`} style={s.styles.body}>
                  {member.userId} - {member.role.replace("_", " ")}
                </Text>
              ))
            ) : (
              <Text style={s.styles.body}>No members have joined yet.</Text>
            )}
          </View>
        </DSCard>

      </DSCard>
    </ScrollView>
  );
}
