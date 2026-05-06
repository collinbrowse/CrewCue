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
  const myUserId = shell.auth.claims?.sub;
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

  const userIdToDisplayName = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of memberships) {
      const name = (m.displayName ?? "").trim();
      if (name) map.set(m.userId, name);
    }
    return map;
  }, [memberships]);

  // Connect to Stream + bootstrap channel when an active room is available.
  useEffect(() => {
    let cancelled = false;
    if (!room || !myUserId || !api) return undefined;
    (async () => {
      try {
        const tokenResp = await api.getChatStreamToken();
        if (cancelled) return;
        const sc = await getOrConnectStreamClient(tokenResp);
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
        setMessages(toViewMessages(initial.messages, key, myUserId, userIdToDisplayName));
      } catch (e) {
        if (!cancelled) setError(humanizeError(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [room, myUserId, api, userIdToDisplayName]);

  // Realtime event wiring: incoming messages, typing, reactions, read state.
  useEffect(() => {
    if (!channel || !channelKey || !myUserId) return undefined;
    const handleNewMessage = (event: StreamEvent) => {
      if (!event.message) return;
      const view = toViewMessage(event.message, channelKey, myUserId, userIdToDisplayName);
      if (!view) return;
      setMessages((prev) => upsertMessage(prev, view));
    };
    const handleTyping = (event: StreamEvent) => {
      const id = event.user?.id;
      if (!id || id === myUserId) return;
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
  }, [channel, channelKey, myUserId, userIdToDisplayName]);

  // Drain any pending outbox entries from prior sessions on mount/key change.
  useEffect(() => {
    if (!room || !channel || !channelKey || !myUserId) return;
    void retryOutbox(room.id, channel, channelKey, myUserId, userIdToDisplayName, setMessages);
  }, [room, channel, channelKey, myUserId, userIdToDisplayName]);

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
    if (!room || !channel || !channelKey || !myUserId) return;
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
      pendingEntryToView(entry, myUserId, userIdToDisplayName.get(myUserId) ?? "You", new Date())
    ]);
    await sendOutboxEntry(entry, channel, channelKey, myUserId, userIdToDisplayName, setMessages);
  };

  const handleRetry = async (entryId: string) => {
    if (!room || !channel || !channelKey || !myUserId) return;
    const box = await loadOutbox(room.id);
    const entry = box.entries.find((e) => e.id === entryId);
    if (!entry) return;
    await sendOutboxEntry(entry, channel, channelKey, myUserId, userIdToDisplayName, setMessages);
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
          {typingNames(typingUserIds, userIdToDisplayName)} typing…
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
  myUserId: string,
  names: Map<string, string>
): ChatViewMessage[] {
  const out: ChatViewMessage[] = [];
  for (const m of raw) {
    const v = toViewMessage(m, key, myUserId, names);
    if (v) out.push(v);
  }
  return out;
}

type RawMessage = MessageResponse & {
  ciphertext?: string;
  nonce?: string;
  key_version?: number;
  custom_sent_at?: string;
};

function toViewMessage(
  raw: MessageResponse,
  key: { keyB64: string; keyVersion: number },
  myUserId: string,
  names: Map<string, string>
): ChatViewMessage | undefined {
  if (!raw.id) return undefined;
  const message = raw as RawMessage;
  const cipher = readEncryptedFields(message);
  const body = cipher ? decryptIncoming(key.keyB64, cipher) : message.text ?? null;
  const sentAtIso = message.custom_sent_at ?? message.created_at ?? new Date().toISOString();
  const arrivedAtIso = message.created_at ?? sentAtIso;
  const authorId = message.user?.id ?? "unknown";
  return {
    id: message.id!,
    isOwn: authorId === myUserId,
    authorUserId: authorId,
    authorDisplayName: names.get(authorId) ?? authorId,
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
  if (!raw.ciphertext || !raw.nonce || typeof raw.key_version !== "number") return undefined;
  return { ciphertextB64: raw.ciphertext, nonceB64: raw.nonce, keyVersion: raw.key_version };
}

function pendingEntryToView(
  entry: ChatOutboxEntry,
  myUserId: string,
  myName: string,
  now: Date
): ChatViewMessage {
  return {
    id: `outbox-${entry.id}`,
    isOwn: true,
    authorUserId: myUserId,
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
  const idx = prev.findIndex((m) => m.id === next.id);
  if (idx < 0) return [...prev, next];
  const copy = [...prev];
  copy[idx] = next;
  return copy;
}

function typingNames(userIds: string[], names: Map<string, string>): string {
  const display = userIds.map((id) => names.get(id) ?? "Someone");
  if (display.length === 1) return display[0]!;
  if (display.length === 2) return `${display[0]} and ${display[1]}`;
  return `${display.slice(0, 2).join(", ")} and ${display.length - 2} more`;
}

async function sendOutboxEntry(
  entry: ChatOutboxEntry,
  channel: Channel,
  key: { keyB64: string; keyVersion: number },
  myUserId: string,
  names: Map<string, string>,
  setMessages: React.Dispatch<React.SetStateAction<ChatViewMessage[]>>
): Promise<void> {
  await markSending(entry.roomId, entry.id);
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
    setMessages((prev) =>
      prev.map((m) =>
        m.outboxId === entry.id
          ? toViewMessage(sent.message as MessageResponse, key, myUserId, names) ?? m
          : m
      )
    );
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
  myUserId: string,
  names: Map<string, string>,
  setMessages: React.Dispatch<React.SetStateAction<ChatViewMessage[]>>
): Promise<void> {
  const box = await loadOutbox(roomId);
  for (const entry of box.entries) {
    if (entry.status === "sent") continue;
    setMessages((prev) =>
      upsertMessage(prev, pendingEntryToView(entry, myUserId, names.get(myUserId) ?? "You", new Date(entry.createdAtMs)))
    );
    await sendOutboxEntry(entry, channel, key, myUserId, names, setMessages);
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
