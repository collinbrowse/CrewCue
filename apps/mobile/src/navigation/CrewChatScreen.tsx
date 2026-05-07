/**
 * Crew chat (E2E) screen.
 *
 * Strict end-to-end encryption: messages are encrypted on this device with the
 * per-channel symmetric key (see features/chat/chatChannel) and the server
 * stores ciphertext only. Stream Chat is the realtime transport.
 *
 * UI requirements covered:
 *   - own messages on the right, others on the left
 *   - typing indicator + "read by everyone" footer when applicable
 *   - mention rendering with bold display name
 *   - fixed reaction set (long-press to react)
 *   - hold-and-swipe to reveal sent / arrived timestamps
 *   - send progress + failed state with unlimited retry
 *   - retention banner once the event has ended
 */
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ListRenderItemInfo
} from "react-native";
import type { Channel, Event as StreamEvent, MessageResponse, StreamChat } from "stream-chat";
import { createApiClient, type ApiClient } from "../api/client";
import { DSButton, DSCard, DSTextInput, useDSTheme } from "../design-system";
import { useAuthedShell } from "../shell/AuthedShellContext";
import {
  bootstrapChannelKey,
  decryptIncoming,
  encryptOutgoing,
  type ChannelMember
} from "../features/chat/chatChannel";
import { computeChatRemovalDateClient, isEventEndedClient } from "../features/chat/retention";
import { CHAT_REACTIONS, type ChatReactionType } from "../features/chat/reactions";
import { extractMentionedUserIds, parseMentions, suggestMentions, type MentionMember } from "../features/chat/mentions";
import { pickGalleryImage, type PickedImage } from "../features/chat/imagePipeline";
import { formatChatTimestamp } from "../features/chat/timestamps";
import {
  disconnectStreamClient,
  getOrConnectStreamClient,
  joinCrewChannel
} from "../features/chat/streamClient";
import {
  enqueueChatMessage,
  loadOutbox,
  markFailed,
  markSending,
  markSent,
  removeEntry,
  type ChatOutboxEntry
} from "../features/chat/messageQueue";
import { ensureDeviceIdentity } from "../features/chat/keyStore";
import { registerChatPushToken } from "../features/chat/pushTokenRegistration";
import { rememberStreamUserIdForAuthSub, streamUserIdForAuthSub } from "../features/chat/streamUserId";
import { setChatUnreadCount } from "../features/chat/unreadBadge";
import type { ChatStackParamList } from "./types";

type Nav = NativeStackNavigationProp<ChatStackParamList, "ChatHome">;

type ChatViewMessage = {
  id: string;
  isOwn: boolean;
  authorUserId: string;
  authorDisplayName: string;
  body: string | null;
  imageUrl?: string;
  sentAt: Date;
  arrivedAt?: Date;
  reactionCounts: Record<string, number>;
  isPending?: boolean;
  isFailed?: boolean;
  outboxId?: string;
};

export function CrewChatScreen(): ReactElement {
  const navigation = useNavigation<Nav>();
  const theme = useDSTheme();
  const shell = useAuthedShell();
  const styles = makeStyles(theme);
  const room = shell.room;
  /** Auth0 subject — crew memberships, API device registry, mention metadata. */
  const authSub = shell.auth.claims?.sub;
  /** Stream `user.id` for the signed-in user (derived on the server from `authSub`). */
  const [myStreamUserId, setMyStreamUserId] = useState<string | undefined>();
  /** `message.user.id` (Stream) → display name for bubbles and typing. */
  const [streamIdToDisplayName, setStreamIdToDisplayName] = useState<Map<string, string>>(() => new Map());
  const accessToken = shell.auth.accessToken;
  const baseUrl = shell.baseUrl;

  const api = useMemo<ApiClient | undefined>(() => {
    if (!accessToken) return undefined;
    return createApiClient({ baseUrl, accessToken });
  }, [accessToken, baseUrl]);

  const [client, setClient] = useState<StreamChat | undefined>();
  const [channel, setChannel] = useState<Channel | undefined>();
  const [channelKey, setChannelKey] = useState<{ keyB64: string; keyVersion: number } | undefined>();
  const [messages, setMessages] = useState<ChatViewMessage[]>([]);
  const [composer, setComposer] = useState("");
  const [pendingImage, setPendingImage] = useState<PickedImage | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [typingUserIds, setTypingUserIds] = useState<string[]>([]);
  const [readByEveryone, setReadByEveryone] = useState(false);
  const [revealedMessageId, setRevealedMessageId] = useState<string | undefined>();
  const composerRef = useRef<TextInput | null>(null);

  const memberships: MentionMember[] = useMemo(() => room?.memberships ?? [], [room]);

  /** Content-based key so Stream connect does not churn on new `memberships` array references. */
  const chatMembershipKey = useMemo(() => {
    const list = room?.memberships ?? [];
    return list
      .map((m) => `${m.userId}:${(m.displayName ?? "").trim()}`)
      .sort()
      .join("|");
  }, [room?.memberships]);

  const userIdToDisplayName = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of memberships) {
      const name = (m.displayName ?? "").trim();
      if (name) map.set(m.userId, name);
    }
    return map;
  }, [memberships]);

  // Keep Stream id → display name in sync when roster changes (no Stream reconnect required).
  useEffect(() => {
    if (!authSub) return;
    let cancelled = false;
    void (async () => {
      const map = await buildStreamIdDisplayNameMap(memberships);
      if (!cancelled) setStreamIdToDisplayName(map);
    })();
    return () => {
      cancelled = true;
    };
  }, [chatMembershipKey, authSub]);

  // Connect to Stream + bootstrap channel when an active room is available.
  useEffect(() => {
    let cancelled = false;
    if (!room || !authSub || !api) return undefined;
    (async () => {
      try {
        const tokenResp = await api.getChatStreamToken({ roomId: room.id });
        if (cancelled) return;
        rememberStreamUserIdForAuthSub(authSub, tokenResp.streamUserId);
        setMyStreamUserId(tokenResp.streamUserId);
        if (cancelled) return;
        const selfMember = memberships.find((m) => m.userId === authSub);
        const selfLabel = selfMember
          ? resolveRosterDisplayName(selfMember, room.athleteId, room.creatorName)
          : "";
        const sc = await getOrConnectStreamClient(tokenResp, {
          displayName: selfLabel || undefined
        });
        if (cancelled) return;
        setClient(sc);
        const ch = await joinCrewChannel(sc, room.id);
        if (cancelled) return;
        setChannel(ch);

        const memberDevices: ChannelMember[] = [];
        for (const m of room.memberships) {
          const lookup = await api.listChatDevicesForUser(m.userId);
          memberDevices.push({
            userId: m.userId,
            devices: lookup.devices.map((d) => ({ deviceId: d.deviceId, publicKey: d.publicKey }))
          });
        }
        const key = await bootstrapChannelKey(api, room.id, memberDevices);
        if (cancelled) return;
        setChannelKey(key);

        const streamNames = await buildStreamIdDisplayNameMap(
          memberships,
          room.athleteId,
          room.creatorName
        );
        streamNames.set(tokenResp.streamUserId, selfLabel || "You");
        if (cancelled) return;
        setStreamIdToDisplayName(streamNames);

        // Register push token (best-effort; permission may be denied)
        try {
          const identity = await ensureDeviceIdentity();
          await registerChatPushToken(api, { deviceId: identity.deviceId });
        } catch {
          // user declined permissions; Phase 6 NSE/FCM still won't fire but
          // chat continues to work — silent failure is intentional.
        }

        const initial = await ch.query({ messages: { limit: 50 } });
        if (cancelled) return;
        setMessages(toViewMessages(initial.messages, key, tokenResp.streamUserId, streamNames));
      } catch (e) {
        if (!cancelled) setError(humanizeError(e));
      }
    })();
    return () => {
      cancelled = true;
      setMyStreamUserId(undefined);
    };
  }, [room?.id, authSub, api, chatMembershipKey]);

  // Realtime event wiring: incoming messages, typing, reactions, read state.
  useEffect(() => {
    if (!channel || !channelKey || !myStreamUserId) return undefined;
    const handleNewMessage = (event: StreamEvent) => {
      if (!event.message) return;
      const view = toViewMessage(event.message, channelKey, myStreamUserId, streamIdToDisplayName);
      if (!view) return;
      // Local send path already merges the server message; ingesting `message.new`
      // for the same id duplicates rows and breaks FlatList keys.
      if (view.isOwn) return;
      setMessages((prev) => upsertMessage(prev, view));
    };
    const handleTyping = (event: StreamEvent) => {
      const id = event.user?.id;
      if (!id || id === myStreamUserId) return;
      setTypingUserIds((prev) => Array.from(new Set([...prev, id])));
    };
    const handleStopTyping = (event: StreamEvent) => {
      const id = event.user?.id;
      if (!id) return;
      setTypingUserIds((prev) => prev.filter((u) => u !== id));
    };
    const handleRead = () => {
      const memberCount = Object.keys(channel.state.read).length;
      const totalMembers = (channel.state.members ? Object.keys(channel.state.members).length : memberCount) || memberCount;
      setReadByEveryone(memberCount > 0 && memberCount >= totalMembers);
    };
    const handleReaction = (event: StreamEvent) => {
      const id = event.message?.id;
      if (!id) return;
      const counts = (event.message?.reaction_counts as Record<string, number> | undefined) ?? {};
      setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, reactionCounts: { ...counts } } : m)));
    };
    const handleUnread = () => {
      setChatUnreadCount(channel.countUnread());
    };
    const subs = [
      channel.on("message.new", (e: StreamEvent) => {
        handleNewMessage(e);
        handleUnread();
      }),
      channel.on("typing.start", handleTyping),
      channel.on("typing.stop", handleStopTyping),
      channel.on("message.read", () => {
        handleRead();
        handleUnread();
      }),
      channel.on("reaction.new", handleReaction),
      channel.on("reaction.deleted", handleReaction)
    ];
    handleUnread();
    return () => {
      for (const sub of subs) sub.unsubscribe();
    };
  }, [channel, channelKey, myStreamUserId, streamIdToDisplayName]);

  // Drain any pending outbox entries from prior sessions on mount/key change.
  useEffect(() => {
    if (!room || !channel || !channelKey || !authSub || !myStreamUserId) return;
    void retryOutbox(
      room.id,
      channel,
      channelKey,
      myStreamUserId,
      streamIdToDisplayName,
      userIdToDisplayName,
      authSub,
      setMessages
    );
  }, [room?.id, channel, channelKey, authSub, myStreamUserId, streamIdToDisplayName, userIdToDisplayName]);

  // Viewing the screen counts as reading. Reset the tab badge.
  useEffect(() => {
    if (!channel) return;
    void channel.markRead();
    setChatUnreadCount(0);
  }, [channel, messages.length]);

  // Cleanup on unmount: disconnect from Stream so background app stops paying.
  useEffect(() => {
    return () => {
      void disconnectStreamClient();
    };
  }, []);

  const handleSend = async () => {
    if (!room || !channel || !channelKey || !authSub || !myStreamUserId) return;
    const trimmed = composer.trim();
    if (!trimmed && !pendingImage) return;
    const mentioned = extractMentionedUserIds(trimmed, memberships);
    const entry = await enqueueChatMessage({
      roomId: room.id,
      body: trimmed,
      attachmentUri: pendingImage?.uri,
      attachmentMimeType: pendingImage?.mimeType,
      mentionedUserIds: mentioned
    });
    setComposer("");
    setPendingImage(undefined);
    setMessages((prev) => [
      ...prev,
      pendingEntryToView(
        entry,
        myStreamUserId,
        streamIdToDisplayName.get(myStreamUserId) ?? userIdToDisplayName.get(authSub) ?? "You",
        new Date()
      )
    ]);
    await sendOutboxEntry(
      entry,
      channel,
      channelKey,
      myStreamUserId,
      streamIdToDisplayName,
      setMessages
    );
  };

  const handleRetry = async (entryId: string) => {
    if (!room || !channel || !channelKey || !myStreamUserId) return;
    const box = await loadOutbox(room.id);
    const entry = box.entries.find((e) => e.id === entryId);
    if (!entry) return;
    await sendOutboxEntry(entry, channel, channelKey, myStreamUserId, streamIdToDisplayName, setMessages);
  };

  const handlePickImage = async () => {
    try {
      const picked = await pickGalleryImage();
      if (picked) setPendingImage(picked);
    } catch {
      Alert.alert("Image picker", "Could not open gallery.");
    }
  };

  const handleReact = async (messageId: string, type: ChatReactionType) => {
    if (!channel) return;
    try {
      await channel.sendReaction(messageId, { type });
    } catch (e) {
      Alert.alert("Reaction failed", humanizeError(e));
    }
  };

  if (!room) {
    return (
      <View style={[styles.container, styles.center]}>
        <DSCard>
          <Text style={styles.title}>Crew chat</Text>
          <Text style={styles.body}>Activate or join a race room to chat with your crew.</Text>
        </DSCard>
      </View>
    );
  }

  const eventEnded = isEventEndedClient(room.eventEndsAt);
  const removalDate = room.eventEndsAt ? computeChatRemovalDateClient(room.eventEndsAt) : undefined;

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>{room.crewName ?? room.name}</Text>
        <Pressable
          onPress={() => navigation.navigate("ChatNotificationPrefs")}
          accessibilityRole="button"
          style={styles.iconButton}
        >
          <Ionicons name="notifications-outline" size={20} color={theme.color.text} />
        </Pressable>
      </View>
      {error ? (
        <DSCard style={styles.errorCard}>
          <Text style={[styles.body, { color: theme.color.danger }]}>{error}</Text>
        </DSCard>
      ) : null}
      {eventEnded && removalDate ? (
        <DSCard style={styles.banner}>
          <Text style={styles.bannerText}>
            Crew chat will be removed on {removalDate.toLocaleDateString()}.
          </Text>
        </DSCard>
      ) : null}
      <FlatList
        data={messages}
        keyExtractor={(m) => m.id}
        contentContainerStyle={styles.listContent}
        renderItem={(info) => (
          <MessageBubble
            info={info}
            theme={theme}
            memberships={memberships}
            revealed={revealedMessageId === info.item.id}
            onLongPress={(id) => setRevealedMessageId(id)}
            onReleaseReveal={() => setRevealedMessageId(undefined)}
            onReact={handleReact}
            onRetry={handleRetry}
          />
        )}
        ListEmptyComponent={
          <DSCard style={styles.emptyCard}>
            <Text style={styles.body}>No messages yet. Say hi to your crew.</Text>
          </DSCard>
        }
      />
      {readByEveryone ? <Text style={styles.readBy}>Read by everyone</Text> : null}
          {typingUserIds.length > 0 ? (
        <Text style={styles.typing}>
          {typingNames(typingUserIds, streamIdToDisplayName)} typing…
        </Text>
      ) : null}
      <Composer
        value={composer}
        onChange={setComposer}
        memberships={memberships}
        pendingImage={pendingImage}
        onClearImage={() => setPendingImage(undefined)}
        onPickImage={handlePickImage}
        onSend={handleSend}
        onTyping={() => channel?.keystroke()}
      />
    </View>
  );
}

type ComposerProps = {
  value: string;
  onChange: (v: string) => void;
  memberships: MentionMember[];
  pendingImage: PickedImage | undefined;
  onClearImage: () => void;
  onPickImage: () => Promise<void>;
  onSend: () => Promise<void>;
  onTyping: () => void;
};

function Composer(props: ComposerProps): ReactElement {
  const theme = useDSTheme();
  const styles = makeStyles(theme);
  const [caretIndex, setCaretIndex] = useState(props.value.length);
  const suggestions = useMemo(
    () => suggestMentions(props.value, caretIndex, props.memberships),
    [props.value, caretIndex, props.memberships]
  );

  const handleSelectMention = (member: MentionMember) => {
    const head = props.value.slice(0, caretIndex);
    const trigger = head.lastIndexOf("@");
    if (trigger < 0) return;
    const tail = props.value.slice(caretIndex);
    const inserted = `@${member.displayName ?? ""} `;
    const next = head.slice(0, trigger) + inserted + tail;
    props.onChange(next);
  };

  return (
    <View style={styles.composer}>
      {suggestions.length > 0 ? (
        <View style={styles.suggestionList}>
          {suggestions.map((s) => (
            <Pressable
              key={s.userId}
              style={styles.suggestionRow}
              onPress={() => handleSelectMention(s)}
            >
              <Text style={styles.suggestionText}>@{s.displayName}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {props.pendingImage ? (
        <View style={styles.attachmentRow}>
          <Image source={{ uri: props.pendingImage.uri }} style={styles.attachmentThumb} />
          <Pressable onPress={props.onClearImage} accessibilityRole="button">
            <Ionicons name="close-circle" size={22} color={theme.color.text} />
          </Pressable>
        </View>
      ) : null}
      <View style={styles.composerRow}>
        <Pressable
          onPress={props.onPickImage}
          accessibilityRole="button"
          style={styles.iconButton}
        >
          <Ionicons name="image-outline" size={22} color={theme.color.text} />
        </Pressable>
        <DSTextInput
          value={props.value}
          onChangeText={(v) => {
            props.onChange(v);
            props.onTyping();
          }}
          onSelectionChange={(e) => setCaretIndex(e.nativeEvent.selection.end)}
          placeholder="Message your crew"
          multiline
          style={styles.composerInput}
        />
        <DSButton preset="primary" onPress={() => void props.onSend()}>
          Send
        </DSButton>
      </View>
    </View>
  );
}

type MessageBubbleProps = {
  info: ListRenderItemInfo<ChatViewMessage>;
  theme: ReturnType<typeof useDSTheme>;
  memberships: MentionMember[];
  revealed: boolean;
  onLongPress: (id: string) => void;
  onReleaseReveal: () => void;
  onReact: (id: string, type: ChatReactionType) => void;
  onRetry: (entryId: string) => void;
};

function MessageBubble({
  info,
  theme,
  memberships,
  revealed,
  onLongPress,
  onReleaseReveal,
  onReact,
  onRetry
}: MessageBubbleProps): ReactElement {
  const message = info.item;
  const styles = makeStyles(theme);
  const align = message.isOwn ? styles.alignRight : styles.alignLeft;
  const bubbleColor = message.isOwn ? theme.color.primary : theme.color.card;
  const textColor = message.isOwn ? theme.color.authPrimaryActionText : theme.color.text;
  const ts = formatChatTimestamp(message.sentAt, message.arrivedAt);
  const tokens = parseMentions(message.body ?? "", memberships);
  const [picker, setPicker] = useState(false);

  return (
    <View style={[styles.messageRow, align]}>
      {!message.isOwn ? <Text style={styles.author}>{message.authorDisplayName}</Text> : null}
      <Pressable
        onLongPress={() => {
          onLongPress(message.id);
          setPicker(true);
        }}
        onPressOut={() => onReleaseReveal()}
        style={[styles.bubble, { backgroundColor: bubbleColor }]}
        accessibilityRole="text"
      >
        {message.imageUrl ? (
          <Image source={{ uri: message.imageUrl }} style={styles.bubbleImage} />
        ) : null}
        {message.body ? (
          <Text style={{ color: textColor }}>
            {tokens.map((t, i) => {
              if (t.kind === "mention") {
                return (
                  <Text key={`${i}-m`} style={{ fontWeight: "700", color: textColor }}>
                    @{t.displayName}
                  </Text>
                );
              }
              return <Text key={`${i}-t`}>{t.text}</Text>;
            })}
          </Text>
        ) : null}
        {message.isPending ? (
          <View style={styles.progressBar}>
            <ActivityIndicator size="small" color={textColor} />
          </View>
        ) : null}
        {message.isFailed && message.outboxId ? (
          <Pressable onPress={() => onRetry(message.outboxId!)}>
            <Text style={[styles.retry, { color: theme.color.danger }]}>Failed — tap to retry</Text>
          </Pressable>
        ) : null}
      </Pressable>
      {revealed ? (
        <View style={styles.timestampReveal}>
          <Text style={styles.timestampText}>sent {ts.sent}</Text>
          {ts.arrived ? <Text style={styles.timestampText}>arrived {ts.arrived}</Text> : null}
        </View>
      ) : null}
      {Object.entries(message.reactionCounts).filter(([, n]) => n > 0).length > 0 ? (
        <View style={styles.reactionsRow}>
          {Object.entries(message.reactionCounts)
            .filter(([, n]) => n > 0)
            .map(([type, count]) => (
              <Text key={type} style={styles.reactionChip}>
                {type} {count}
              </Text>
            ))}
        </View>
      ) : null}
      {picker ? (
        <View style={styles.reactionPicker}>
          {CHAT_REACTIONS.map((r) => (
            <Pressable
              key={r}
              onPress={() => {
                setPicker(false);
                onReact(message.id, r);
              }}
              style={styles.reactionPickerItem}
            >
              <Text style={styles.reactionGlyph}>{r}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function toViewMessages(
  raw: MessageResponse[],
  key: { keyB64: string; keyVersion: number },
  viewerStreamUserId: string,
  streamIdToDisplayName: Map<string, string>
): ChatViewMessage[] {
  const out: ChatViewMessage[] = [];
  for (const m of raw) {
    const v = toViewMessage(m, key, viewerStreamUserId, streamIdToDisplayName);
    if (v) out.push(v);
  }
  return normalizeMessageList(out);
}

const UNLOCK_BODY_PLACEHOLDER =
  "[Could not decrypt on this device. Another member may need to open chat once so your device receives the room key.]";

type RawMessage = MessageResponse & {
  ciphertext?: string;
  nonce?: string;
  key_version?: number;
  keyVersion?: number;
  custom_sent_at?: string;
  user_id?: string;
};

function resolveAuthorStreamId(raw: MessageResponse): string {
  const m = raw as RawMessage;
  const fromUser = m.user?.id?.trim();
  if (fromUser) return fromUser;
  const flat = m.user_id?.trim();
  if (flat) return flat;
  return "unknown";
}

function parseKeyVersion(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function toViewMessage(
  raw: MessageResponse,
  key: { keyB64: string; keyVersion: number },
  viewerStreamUserId: string,
  streamIdToDisplayName: Map<string, string>
): ChatViewMessage | undefined {
  if (!raw.id) return undefined;
  const message = raw as RawMessage;
  const cipher = readEncryptedFields(message);
  let body: string | null;
  if (cipher) {
    const decrypted = decryptIncoming(key.keyB64, cipher);
    body = decrypted ?? UNLOCK_BODY_PLACEHOLDER;
  } else {
    body = message.text ?? null;
  }
  const sentAtIso = message.custom_sent_at ?? message.created_at ?? new Date().toISOString();
  const arrivedAtIso = message.created_at ?? sentAtIso;
  const authorId = resolveAuthorStreamId(message);
  const streamName = (message.user?.name ?? "").trim();
  const normalizedStreamName =
    streamName && !/^u-[a-f0-9]{8,}$/i.test(streamName) ? streamName : "";
  const authorDisplayName =
    streamIdToDisplayName.get(authorId) ||
    (normalizedStreamName && normalizedStreamName !== authorId ? normalizedStreamName : "") ||
    authorId;
  return {
    id: message.id!,
    isOwn: authorId === viewerStreamUserId,
    authorUserId: authorId,
    authorDisplayName,
    body,
    imageUrl: (message.attachments?.[0]?.image_url as string | undefined) ?? undefined,
    sentAt: new Date(sentAtIso),
    arrivedAt: new Date(arrivedAtIso),
    reactionCounts: { ...((message.reaction_counts as Record<string, number> | undefined) ?? {}) }
  };
}

function readEncryptedFields(
  raw: RawMessage
): { ciphertextB64: string; nonceB64: string; keyVersion: number } | undefined {
  const keyVersion = parseKeyVersion(raw.key_version ?? raw.keyVersion);
  if (!raw.ciphertext || !raw.nonce || keyVersion === undefined) return undefined;
  return { ciphertextB64: raw.ciphertext, nonceB64: raw.nonce, keyVersion };
}

function pendingEntryToView(
  entry: ChatOutboxEntry,
  viewerStreamUserId: string,
  myName: string,
  now: Date
): ChatViewMessage {
  return {
    id: `outbox-${entry.id}`,
    isOwn: true,
    authorUserId: viewerStreamUserId,
    authorDisplayName: myName,
    body: entry.body,
    imageUrl: entry.attachmentUri,
    sentAt: now,
    arrivedAt: undefined,
    reactionCounts: {},
    isPending: true,
    outboxId: entry.id
  };
}

function upsertMessage(prev: ChatViewMessage[], next: ChatViewMessage): ChatViewMessage[] {
  return normalizeMessageList([...prev.filter((m) => m.id !== next.id), next]);
}

/** Collapse duplicate `id` rows (e.g. race between outbox replace and `message.new`). */
function normalizeMessageList(rows: ChatViewMessage[]): ChatViewMessage[] {
  const byId = new Map<string, ChatViewMessage>();
  for (const m of rows) {
    const ex = byId.get(m.id);
    if (!ex) {
      byId.set(m.id, m);
      continue;
    }
    byId.set(m.id, preferChatViewRow(ex, m));
  }
  return Array.from(byId.values()).sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime());
}

function preferChatViewRow(a: ChatViewMessage, b: ChatViewMessage): ChatViewMessage {
  if (a.isPending !== b.isPending) return a.isPending ? b : a;
  if (a.isFailed !== b.isFailed) return a.isFailed ? b : a;
  const aHas = Boolean((a.body ?? "").trim());
  const bHas = Boolean((b.body ?? "").trim());
  if (aHas !== bHas) return aHas ? a : b;
  return b;
}

function resolveRosterDisplayName(
  member: MentionMember,
  athleteId: string | undefined,
  creatorName: string | undefined
): string {
  const direct = (member.displayName ?? "").trim();
  if (direct) return direct;
  if (athleteId && member.userId === athleteId) {
    const creator = (creatorName ?? "").trim();
    if (creator) return creator;
  }
  return "Crew member";
}

async function buildStreamIdDisplayNameMap(
  memberships: MentionMember[],
  athleteId?: string,
  creatorName?: string
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (const m of memberships) {
    const name = resolveRosterDisplayName(m, athleteId, creatorName);
    if (!name) continue;
    const memberUserId = m.userId.trim();
    // Defensive mapping: some roster payloads carry Auth0 `sub`, others may
    // already carry Stream ids (`u-...`). Populate both to avoid raw-id UI.
    if (memberUserId) {
      map.set(memberUserId, name);
    }
    try {
      const sid = await streamUserIdForAuthSub(memberUserId);
      map.set(sid, name);
    } catch {}
  }
  return map;
}

function typingNames(userIds: string[], streamIdToDisplayName: Map<string, string>): string {
  const display = userIds.map((id) => streamIdToDisplayName.get(id) ?? "Someone");
  if (display.length === 1) return display[0]!;
  if (display.length === 2) return `${display[0]} and ${display[1]}`;
  return `${display.slice(0, 2).join(", ")} and ${display.length - 2} more`;
}

async function sendOutboxEntry(
  entry: ChatOutboxEntry,
  channel: Channel,
  key: { keyB64: string; keyVersion: number },
  myStreamUserId: string,
  streamIdToDisplayName: Map<string, string>,
  setMessages: React.Dispatch<React.SetStateAction<ChatViewMessage[]>>
): Promise<void> {
  const marked = await markSending(entry.roomId, entry.id);
  if (!marked) return;
  setMessages((prev) =>
    prev.map((m) =>
      m.outboxId === entry.id ? { ...m, isPending: true, isFailed: false } : m
    )
  );
  try {
    const enc = encryptOutgoing(key.keyB64, entry.body, key.keyVersion);
    let attachments;
    if (entry.attachmentUri) {
      const upload = await channel.sendImage(entry.attachmentUri, "chat-image.jpg", entry.attachmentMimeType ?? "image/jpeg");
      attachments = [{ type: "image", image_url: upload.file }];
    }
    const sent = await channel.sendMessage({
      ciphertext: enc.ciphertextB64,
      nonce: enc.nonceB64,
      key_version: enc.keyVersion,
      custom_sent_at: new Date(entry.createdAtMs).toISOString(),
      mentioned_user_ids: entry.mentionedUserIds,
      attachments
    } as Parameters<Channel["sendMessage"]>[0]);
    const remoteId = sent.message?.id ?? entry.id;
    await markSent(entry.roomId, entry.id, remoteId);
    await removeEntry(entry.roomId, entry.id);
    setMessages((prev) => {
      const mapped = prev.map((m) =>
        m.outboxId === entry.id
          ? toViewMessage(sent.message as MessageResponse, key, myStreamUserId, streamIdToDisplayName) ?? m
          : m
      );
      return normalizeMessageList(mapped);
    });
  } catch (e) {
    await markFailed(entry.roomId, entry.id, humanizeError(e));
    setMessages((prev) =>
      prev.map((m) => (m.outboxId === entry.id ? { ...m, isPending: false, isFailed: true } : m))
    );
  }
}

async function retryOutbox(
  roomId: string,
  channel: Channel,
  key: { keyB64: string; keyVersion: number },
  myStreamUserId: string,
  streamIdToDisplayName: Map<string, string>,
  authDisplayBySub: Map<string, string>,
  authSub: string,
  setMessages: React.Dispatch<React.SetStateAction<ChatViewMessage[]>>
): Promise<void> {
  const box = await loadOutbox(roomId);
  for (const entry of box.entries) {
    if (entry.status === "sent") continue;
    const myName =
      streamIdToDisplayName.get(myStreamUserId) ?? authDisplayBySub.get(authSub) ?? "You";
    setMessages((prev) =>
      upsertMessage(prev, pendingEntryToView(entry, myStreamUserId, myName, new Date(entry.createdAtMs)))
    );
    await sendOutboxEntry(entry, channel, key, myStreamUserId, streamIdToDisplayName, setMessages);
  }
}

function humanizeError(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  return "Unknown error";
}

function makeStyles(theme: ReturnType<typeof useDSTheme>) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.color.background,
      paddingHorizontal: theme.spacing.gutter ?? 12,
      paddingTop: 8,
      gap: 8
    },
    center: { justifyContent: "center", alignItems: "center" },
    title: { color: theme.color.text, fontSize: 18, fontWeight: "700" },
    body: { color: theme.color.body, fontSize: 14 },
    headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    iconButton: { padding: 8 },
    listContent: { gap: 6, paddingVertical: 12 },
    emptyCard: { padding: 16 },
    errorCard: { padding: 12, borderColor: theme.color.danger, borderWidth: 1 },
    banner: { backgroundColor: theme.color.warning, padding: 12 },
    bannerText: { color: theme.color.text, fontSize: 13 },
    messageRow: { gap: 4, marginVertical: 2 },
    alignLeft: { alignSelf: "flex-start", maxWidth: "85%" },
    alignRight: { alignSelf: "flex-end", maxWidth: "85%" },
    bubble: { padding: 10, borderRadius: 14 },
    bubbleImage: { width: 200, height: 200, borderRadius: 8, marginBottom: 6 },
    author: { color: theme.color.muted, fontSize: 12 },
    progressBar: { marginTop: 4 },
    retry: { fontSize: 12, marginTop: 4 },
    timestampReveal: { padding: 4 },
    timestampText: { color: theme.color.muted, fontSize: 11 },
    reactionsRow: { flexDirection: "row", gap: 6, paddingHorizontal: 4 },
    reactionChip: { color: theme.color.text, fontSize: 12 },
    reactionPicker: { flexDirection: "row", gap: 4, padding: 6 },
    reactionPickerItem: { padding: 4 },
    reactionGlyph: { fontSize: 22 },
    composer: { gap: 6, paddingBottom: 8 },
    composerRow: { flexDirection: "row", alignItems: "flex-end", gap: 6 },
    composerInput: { flex: 1 },
    suggestionList: {
      borderColor: theme.color.divider,
      borderWidth: 1,
      borderRadius: 8,
      padding: 6,
      gap: 4
    },
    suggestionRow: { paddingVertical: 6 },
    suggestionText: { color: theme.color.text, fontSize: 14 },
    attachmentRow: { flexDirection: "row", alignItems: "center", gap: 6 },
    attachmentThumb: { width: 64, height: 64, borderRadius: 8 },
    typing: { color: theme.color.muted, fontSize: 12, paddingHorizontal: 4 },
    readBy: { color: theme.color.muted, fontSize: 11, alignSelf: "flex-end" }
  });
}
