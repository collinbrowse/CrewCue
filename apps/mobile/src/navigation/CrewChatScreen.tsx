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
import { BlurView } from "expo-blur";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement
} from "react";
import Animated, { FadeInDown, FadeOutDown } from "react-native-reanimated";
import {
  ActivityIndicator,
  FlatList,
  Image,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type ListRenderItemInfo,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ViewToken
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { Channel, Event as StreamEvent, MessageResponse, StreamChat } from "stream-chat";
import { createApiClient, type ApiClient } from "../api/client";
import { DSButton, DSCard, DSTextInput, useDSTheme } from "../design-system";
import { getErrorMessage, mapApiError } from "@crewcue/platform-client";
import { useAuthedShell } from "../shell/AuthedShellContext";
import { decryptIncoming, encryptOutgoing } from "../features/chat/chatChannel";
import { computeChatRemovalDateClient, isEventEndedClient } from "../features/chat/retention";
import { CHAT_REACTIONS, type ChatReactionType } from "../features/chat/reactions";
import { extractMentionedUserIds, parseMentions, suggestMentions, type MentionMember } from "../features/chat/mentions";
import { pickGalleryImage, type PickedImage } from "../features/chat/imagePipeline";
import { formatChatTimestamp } from "../features/chat/timestamps";
import { disconnectStreamClient } from "../features/chat/streamClient";
import {
  enqueueChatMessage,
  loadOutbox,
  markFailed,
  markSending,
  markSent,
  removeEntry,
  type ChatOutboxEntry
} from "../features/chat/messageQueue";
import {
  cacheRowsToChatViewMessages,
  chatViewMessagesToCacheRows,
  loadTranscriptCache,
  saveTranscriptCache
} from "../features/chat/chatTranscriptCache";
import { queryOlderMessagesBefore } from "../features/chat/chatHistoryPaging";
import {
  CHAT_HISTORY_PAGE_SIZE,
  CHAT_INITIAL_MESSAGE_COUNT,
  CHAT_SCROLL_LOAD_MORE_PX
} from "../features/chat/chatMessageLimits";
import { buildStreamIdDisplayNameMap, resolveRosterDisplayName } from "../features/chat/raceChatBootstrap";
import { consumeOrBootstrapRaceChat } from "../features/chat/raceChatPrefetch";
import { setChatUnreadCount } from "../features/chat/unreadBadge";
import type { ChatStackParamList } from "./types";
import { useNavColors } from "./navigationTheme";

type Nav = NativeStackNavigationProp<ChatStackParamList, "ChatHome">;

/**
 * Scroll layout (matches “row content + outer indicator margin” pattern):
 * - `SCROLLBAR_CONTENT_GAP`: padding inside the FlatList so right-aligned bubbles never reach the indicator.
 * - `SCROLLBAR_OUTSIDE_STRIP`: empty sibling column so the OS scrollbar sits in margin, not over bubble chrome.
 */
const SCROLLBAR_CONTENT_GAP = 12;
const SCROLLBAR_OUTSIDE_STRIP = 0;
/** Rough row estimate for FlatList fallback scroll when scrollToIndex needs a synthetic offset */
const ESTIMATED_MESSAGE_ROW_HEIGHT = 92;

type ChatViewMessage = {
  id: string;
  isOwn: boolean;
  authorUserId: string;
  authorDisplayName: string;
  /** Sender photo from Stream `user.image` when present. */
  authorAvatarUrl?: string;
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
  const navColors = useNavColors();
  const shell = useAuthedShell();
  const styles = makeStyles(theme);
  const window = useWindowDimensions();
  const insets = useSafeAreaInsets();
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
  const [composerError, setComposerError] = useState<string | undefined>();
  const [pendingImage, setPendingImage] = useState<PickedImage | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [typingUserIds, setTypingUserIds] = useState<string[]>([]);
  const [readByEveryone, setReadByEveryone] = useState(false);
  const [revealedMessageId, setRevealedMessageId] = useState<string | undefined>();
  const [minUnseenAboveIndex, setMinUnseenAboveIndex] = useState<number | undefined>(undefined);
  /** True until Stream bootstrap (watch + keys) finishes for the current room (or errors). */
  const [isChatHistoryLoading, setIsChatHistoryLoading] = useState(false);
  const [hasMoreHistory, setHasMoreHistory] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [reactionOverlay, setReactionOverlay] = useState<
    { messageId: string; bubbleFrame: { x: number; y: number; width: number; height: number }; pillApproxWidth: number } | undefined
  >(undefined);

  const listRef = useRef<FlatList<ChatViewMessage>>(null);
  const seenMessageIndicesRef = useRef<Set<number>>(new Set());
  const messagesRef = useRef<ChatViewMessage[]>([]);
  messagesRef.current = messages;

  const scrollEndAfterOutgoingRef = useRef(false);
  /** Debounce clearing `scrollEndAfterOutgoingRef` so multiline bubble layout can finish before we stop scrolling. */
  const scrollEndIdleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const anchoredInitialScrollRef = useRef(false);
  const scrollOffsetYRef = useRef(0);
  const loadingOlderRef = useRef(false);
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

  const raceNavTitle =
    shell.raceProfile?.raceName?.trim() || room?.name?.trim() || "Chat";

  useLayoutEffect(() => {
    if (!room) return;
    navigation.setOptions({
      headerTitleAlign: "center",
      headerTitle: () => (
        <Text
          accessibilityRole="header"
          numberOfLines={2}
          style={{
            color: navColors.text,
            fontSize: 17,
            fontWeight: "600",
            textAlign: "center",
            maxWidth: Math.min(260, window.width - 140)
          }}
        >
          {raceNavTitle}
        </Text>
      ),
      headerRight: () => (
        <Pressable
          onPress={() => navigation.navigate("ChatNotificationPrefs")}
          accessibilityRole="button"
          accessibilityLabel="Chat notification preferences"
          style={{ paddingHorizontal: 10, paddingVertical: 8 }}
        >
          <Ionicons name="notifications-outline" size={22} color={navColors.text} />
        </Pressable>
      )
    });
  }, [navigation, navColors.text, raceNavTitle, room, window.width]);

  useEffect(() => {
    anchoredInitialScrollRef.current = false;
    seenMessageIndicesRef.current.clear();
    setMinUnseenAboveIndex(undefined);
    setHasMoreHistory(false);
    loadingOlderRef.current = false;
    setLoadingOlder(false);
    if (!room?.id) {
      setMessages([]);
      setIsChatHistoryLoading(false);
      return;
    }
    setMessages([]);
  }, [room?.id]);

  const viewabilityConfig = useMemo(
    () => ({
      itemVisiblePercentThreshold: 18,
      minimumViewTime: 80
    }),
    []
  );

  const onViewableItemsChanged = useCallback(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    if (loadingOlderRef.current) {
      setMinUnseenAboveIndex(undefined);
      return;
    }
    const len = messagesRef.current.length;
    if (!len) {
      setMinUnseenAboveIndex(undefined);
      return;
    }
    const visible = viewableItems
      .map((v) => v.index)
      .filter((i): i is number => typeof i === "number" && i >= 0);
    if (visible.length === 0) return;
    const lowestVisible = Math.min(...visible);
    for (const i of visible) seenMessageIndicesRef.current.add(i);
    let oldestUnseen: number | undefined;
    for (let i = 0; i < lowestVisible; i++) {
      if (!seenMessageIndicesRef.current.has(i)) {
        oldestUnseen = oldestUnseen === undefined ? i : Math.min(oldestUnseen, i);
      }
    }
    setMinUnseenAboveIndex(oldestUnseen);
  }, []);

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
    if (!room || !authSub || !api) {
      setIsChatHistoryLoading(false);
      return undefined;
    }
    setIsChatHistoryLoading(true);
    void (async () => {
      try {
        setHasMoreHistory(false);
        const cachedRows = await loadTranscriptCache(room.id);
        if (!cancelled && cachedRows.length > 0) {
          setMessages(cacheRowsToChatViewMessages(cachedRows) as ChatViewMessage[]);
          setIsChatHistoryLoading(false);
        }

        const result = await consumeOrBootstrapRaceChat({
          room,
          authSub,
          api,
          memberships,
          chatMembershipKey
        });
        if (cancelled) return;

        setMyStreamUserId(result.streamUserId);
        setClient(result.client);
        setChannel(result.channel);
        setChannelKey(result.channelKey);
        setStreamIdToDisplayName(result.streamIdToDisplayName);

        const view = toViewMessages(
          result.rawInitialMessages,
          result.channelKey,
          result.streamUserId,
          result.streamIdToDisplayName
        );
        setMessages(view);
        setHasMoreHistory(result.rawInitialMessages.length >= CHAT_INITIAL_MESSAGE_COUNT);
        void saveTranscriptCache(room.id, chatViewMessagesToCacheRows(view));
      } catch (e) {
        if (!cancelled) setError(humanizeError(e));
      } finally {
        if (!cancelled) setIsChatHistoryLoading(false);
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

  // Persist last transcript for instant paint on next visit (best-effort).
  useEffect(() => {
    if (!room?.id || messages.length === 0) return;
    const roomId = room.id;
    const handle = setTimeout(() => {
      void saveTranscriptCache(roomId, chatViewMessagesToCacheRows(messagesRef.current));
    }, 900);
    return () => clearTimeout(handle);
  }, [room?.id, messages]);

  const onMessagesContentSizeChange = useCallback((_w: number, _h: number) => {
    if (messagesRef.current.length === 0) return;

    if (!anchoredInitialScrollRef.current) {
      anchoredInitialScrollRef.current = true;
      const lenAtAnchor = messagesRef.current.length;
      requestAnimationFrame(() => {
        listRef.current?.scrollToEnd({ animated: false });
        // Viewability only marks rows that are on-screen; at the bottom every index above
        // the viewport would otherwise look "unseen" and flash the New messages chip.
        requestAnimationFrame(() => {
          for (let i = 0; i < lenAtAnchor; i++) seenMessageIndicesRef.current.add(i);
          setMinUnseenAboveIndex(undefined);
        });
      });
    }

    if (scrollEndAfterOutgoingRef.current) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          listRef.current?.scrollToEnd({ animated: true });
        });
      });
      if (scrollEndIdleTimerRef.current) clearTimeout(scrollEndIdleTimerRef.current);
      scrollEndIdleTimerRef.current = setTimeout(() => {
        scrollEndAfterOutgoingRef.current = false;
        scrollEndIdleTimerRef.current = null;
        requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: false }));
      }, 240);
    }
  }, []);

  const loadOlderMessages = useCallback(async () => {
    if (!channel || !channelKey || !myStreamUserId) return;
    if (loadingOlderRef.current || !hasMoreHistory) return;
    const sorted = [...messagesRef.current].sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime());
    const oldestReal = sorted.find((m) => !m.id.startsWith("outbox-"));
    if (!oldestReal) return;

    loadingOlderRef.current = true;
    setLoadingOlder(true);
    setMinUnseenAboveIndex(undefined);
    try {
      const rawOlder = await queryOlderMessagesBefore(channel, oldestReal.id);
      if (rawOlder.length === 0) {
        setHasMoreHistory(false);
        return;
      }
      const olderViews = toViewMessages(rawOlder, channelKey, myStreamUserId, streamIdToDisplayName);
      const added = olderViews.length;
      setMessages((prev) => {
        const merged = normalizeMessageList([...olderViews, ...prev]);
        if (added > 0) {
          const prevLen = prev.length;
          const oldSeen = [...seenMessageIndicesRef.current];
          seenMessageIndicesRef.current.clear();
          for (const i of oldSeen) {
            if (i >= 0 && i < prevLen) seenMessageIndicesRef.current.add(i + added);
          }
          for (let i = 0; i < added; i++) seenMessageIndicesRef.current.add(i);
        }
        return merged;
      });
      if (rawOlder.length < CHAT_HISTORY_PAGE_SIZE) {
        setHasMoreHistory(false);
      }
    } catch {
      // leave hasMoreHistory; user can scroll again to retry
    } finally {
      loadingOlderRef.current = false;
      setLoadingOlder(false);
      setMinUnseenAboveIndex(undefined);
    }
  }, [channel, channelKey, myStreamUserId, streamIdToDisplayName, hasMoreHistory]);

  const onListScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const y = event.nativeEvent.contentOffset.y;
      scrollOffsetYRef.current = y;
      if (
        y <= CHAT_SCROLL_LOAD_MORE_PX &&
        hasMoreHistory &&
        anchoredInitialScrollRef.current &&
        !loadingOlderRef.current &&
        channel &&
        channelKey &&
        myStreamUserId
      ) {
        void loadOlderMessages();
      }
    },
    [hasMoreHistory, channel, channelKey, myStreamUserId, loadOlderMessages]
  );

  useEffect(() => {
    return () => {
      if (scrollEndIdleTimerRef.current) clearTimeout(scrollEndIdleTimerRef.current);
      void disconnectStreamClient();
    };
  }, []);

  const handleSend = async () => {
    if (!room || !channel || !channelKey || !authSub || !myStreamUserId) return;
    const trimmed = composer.trim();
    if (!trimmed && !pendingImage) return;
    setComposerError(undefined);
    setReactionOverlay(undefined);
    scrollEndAfterOutgoingRef.current = true;
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
      setComposerError(getErrorMessage("unknown"));
    }
  };

  const handleReact = async (messageId: string, type: ChatReactionType) => {
    if (!channel) return;
    setReactionOverlay(undefined);
    try {
      await channel.sendReaction(messageId, { type });
    } catch (e) {
      setComposerError(mapApiError(e).message);
    }
  };

  const scrollToOldestUnseenAbove = useCallback(() => {
    if (minUnseenAboveIndex === undefined) return;
    requestAnimationFrame(() =>
      listRef.current?.scrollToIndex({
        index: minUnseenAboveIndex,
        viewPosition: 0,
        animated: true
      })
    );
  }, [minUnseenAboveIndex]);

  const handleScrollIndexFailed = useCallback((info: { index: number; averageItemLength?: number }) => {
    listRef.current?.scrollToOffset({
      offset: Math.max(0, info.index * ESTIMATED_MESSAGE_ROW_HEIGHT),
      animated: true
    });
  }, []);

  const openReactionPickerForMessage = useCallback(
    (messageId: string, bubbleFrame: { x: number; y: number; width: number; height: number }) => {
      const pillItem = 40;
      const pillPad = 16;
      const pillW = CHAT_REACTIONS.length * pillItem + pillPad;
      const pillH = 44;
      const topSpace = 8;
      const plannedTop = bubbleFrame.y - pillH - topSpace;
      const minTop = insets.top + 6;
      let frame = bubbleFrame;
      if (plannedTop < minTop) {
        const fix = minTop - plannedTop;
        const next = Math.max(0, scrollOffsetYRef.current - fix);
        listRef.current?.scrollToOffset({ offset: next, animated: true });
        frame = { ...bubbleFrame, y: bubbleFrame.y + fix * 0.9 };
      }
      setReactionOverlay({ messageId, bubbleFrame: frame, pillApproxWidth: pillW });
    },
    [insets.top]
  );

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
      <View style={styles.listWrap}>
        {isChatHistoryLoading && messages.length === 0 ? (
          <View style={styles.historyLoading} accessibilityRole="progressbar" accessibilityLabel="Loading chat">
            <ActivityIndicator size="large" color={theme.color.primary} />
            <Text style={styles.historyLoadingText}>Loading messages…</Text>
          </View>
        ) : null}
        <FlatList
          ref={listRef}
          style={styles.listFlatList}
          data={messages}
          keyboardShouldPersistTaps="handled"
          keyExtractor={(m) => m.id}
          contentContainerStyle={[styles.listContent, { paddingRight: SCROLLBAR_CONTENT_GAP }]}
          onScroll={onListScroll}
          scrollEventThrottle={16}
          {...(messages.length > 0
            ? ({
                maintainVisibleContentPosition: {
                  minIndexForVisible: 0,
                  autoscrollToTopThreshold: 24
                }
              } as const)
            : {})}
          onContentSizeChange={onMessagesContentSizeChange}
          viewabilityConfig={viewabilityConfig}
          onViewableItemsChanged={onViewableItemsChanged}
          onScrollToIndexFailed={handleScrollIndexFailed}
          scrollIndicatorInsets={{ right: 0 }}
          {...(Platform.OS === "ios"
            ? ({ automaticallyAdjustsScrollIndicatorInsets: false } as const)
            : {})}
          renderItem={(info) => {
            const nextRow = messages[info.index + 1];
            const showAvatarTail =
              !info.item.isOwn &&
              (info.index >= messages.length - 1 ||
                info.item.authorUserId !== nextRow?.authorUserId);
            return (
              <MessageBubble
                info={info}
                theme={theme}
                memberships={memberships}
                revealed={revealedMessageId === info.item.id}
                reactionHighlight={reactionOverlay?.messageId === info.item.id}
                showAvatarTail={showAvatarTail}
                onRevealLongPress={(id) => setRevealedMessageId(id)}
                onReleaseReveal={() => setRevealedMessageId(undefined)}
                onOpenReactionPicker={(id, frame) => openReactionPickerForMessage(id, frame)}
                onRetry={handleRetry}
              />
            );
          }}
          ListEmptyComponent={
            <DSCard style={styles.emptyCard}>
              <Text style={styles.body}>No messages yet. Say hi to your crew.</Text>
            </DSCard>
          }
          ListHeaderComponent={
            loadingOlder ? (
              <View style={styles.oldPageLoading} accessibilityRole="progressbar" accessibilityLabel="Loading older messages">
                <ActivityIndicator size="small" color={theme.color.muted} />
              </View>
            ) : null
          }
          ListFooterComponent={
            readByEveryone ? (
              <View style={styles.readByListFooter} accessibilityRole="text">
                <Text style={styles.readByListFooterText}>Read by everyone</Text>
              </View>
            ) : null
          }
        />
        <View
          pointerEvents="none"
          style={[styles.scrollGutterStrip, { width: SCROLLBAR_OUTSIDE_STRIP, backgroundColor: theme.color.background }]}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        />
        {minUnseenAboveIndex !== undefined ? (
          <Animated.View
            entering={FadeInDown.springify().damping(16).stiffness(260)}
            exiting={FadeOutDown.duration(170)}
            style={styles.unseenChipWrap}
            pointerEvents="box-none"
          >
            <Pressable
              onPress={scrollToOldestUnseenAbove}
              style={({ pressed }) => [styles.unseenChip, pressed ? { opacity: 0.88 } : null]}
              accessibilityRole="button"
              accessibilityLabel="New messages above, scroll to oldest unseen"
            >
              <Text style={styles.unseenChipText}>New messages</Text>
              <Ionicons name="arrow-up" size={16} color={theme.color.authPrimaryActionText} />
            </Pressable>
          </Animated.View>
        ) : null}
      </View>
      {typingUserIds.length > 0 ? (
        <Text style={styles.typing}>
          {typingNames(typingUserIds, streamIdToDisplayName)} typing…
        </Text>
      ) : null}
      <Composer
        value={composer}
        onChange={(value) => {
          setComposer(value);
          if (composerError) {
            setComposerError(undefined);
          }
        }}
        memberships={memberships}
        pendingImage={pendingImage}
        composerError={composerError}
        onClearImage={() => setPendingImage(undefined)}
        onPickImage={handlePickImage}
        onSend={handleSend}
        onTyping={() => channel?.keystroke()}
      />
      <ReactionOverlayModal
        visible={reactionOverlay !== undefined}
        overlay={reactionOverlay}
        windowWidth={window.width}
        insetsTop={insets.top}
        theme={theme}
        onPick={(type) => {
          if (!reactionOverlay) return;
          void handleReact(reactionOverlay.messageId, type);
        }}
        onDismiss={() => setReactionOverlay(undefined)}
      />
    </View>
  );
}

type ComposerProps = {
  value: string;
  onChange: (v: string) => void;
  memberships: MentionMember[];
  pendingImage: PickedImage | undefined;
  composerError?: string;
  onClearImage: () => void;
  onPickImage: () => Promise<void>;
  onSend: () => Promise<void>;
  onTyping: () => void;
};

function Composer(props: ComposerProps): ReactElement {
  const theme = useDSTheme();
  const styles = makeStyles(theme);
  const [caretIndex, setCaretIndex] = useState(props.value.length);
  /** Remount multiline `TextInput` when cleared so native height returns to single-line (RN quirk). */
  const [composerFieldKey, setComposerFieldKey] = useState(0);
  const prevValueLenRef = useRef(props.value.length);
  const suggestions = useMemo(
    () => suggestMentions(props.value, caretIndex, props.memberships),
    [props.value, caretIndex, props.memberships]
  );

  useEffect(() => {
    const len = props.value.length;
    if (len === 0 && prevValueLenRef.current > 0) {
      setComposerFieldKey((k) => k + 1);
      setCaretIndex(0);
    }
    prevValueLenRef.current = len;
  }, [props.value]);

  const androidInputExtras =
    Platform.OS === "android"
      ? ({
          textAlignVertical: "center" as const,
          includeFontPadding: false
        } satisfies object)
      : undefined;

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
      {props.composerError ? (
        <Text style={styles.composerError} accessibilityRole="alert">
          {props.composerError}
        </Text>
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
          key={`composer-field-${composerFieldKey}`}
          value={props.value}
          onChangeText={(v) => {
            props.onChange(v);
            props.onTyping();
          }}
          onSelectionChange={(e) => setCaretIndex(e.nativeEvent.selection.end)}
          placeholder="Message your crew"
          multiline
          style={[styles.composerInput, androidInputExtras]}
        />
        <DSButton preset="primary" onPress={() => void props.onSend()}>
          Send
        </DSButton>
      </View>
    </View>
  );
}

type ReactionOverlayModalProps = {
  visible: boolean;
  overlay:
    | {
        messageId: string;
        bubbleFrame: { x: number; y: number; width: number; height: number };
        pillApproxWidth: number;
      }
    | undefined;
  windowWidth: number;
  insetsTop: number;
  theme: ReturnType<typeof useDSTheme>;
  onPick: (type: ChatReactionType) => void;
  onDismiss: () => void;
};

function ReactionOverlayModal(props: ReactionOverlayModalProps): ReactElement | null {
  const { visible, overlay, windowWidth, insetsTop, theme, onPick, onDismiss } = props;
  const pillH = 48;
  const styles = makeStyles(theme);
  const open = Boolean(overlay && visible);
  if (!open || !overlay) {
    return null;
  }

  const pillTopRaw = overlay.bubbleFrame.y - pillH - 12;
  const pillTop = Math.max(insetsTop + 8, pillTopRaw);
  const leftRaw =
    overlay.bubbleFrame.x + overlay.bubbleFrame.width / 2 - overlay.pillApproxWidth / 2;
  const gutter = 10;
  const left = Math.max(gutter, Math.min(leftRaw, windowWidth - overlay.pillApproxWidth - gutter));

  return (
    <Modal transparent visible animationType="fade" statusBarTranslucent onRequestClose={onDismiss}>
      <View style={styles.reactionOverlayRoot} pointerEvents="box-none">
        <Pressable style={StyleSheet.absoluteFill} accessibilityLabel="Dismiss reactions" onPress={onDismiss} />
        <View
          style={[
            styles.reactionPillOuter,
            { top: pillTop, left, width: overlay.pillApproxWidth, overflow: "hidden" }
          ]}
          accessibilityRole="toolbar"
        >
          {Platform.OS === "ios" ? (
            <BlurView intensity={56} tint="dark" style={styles.reactionPillBlur}>
              <ReactionPillInner onPick={onPick} theme={theme} />
            </BlurView>
          ) : (
            <View style={styles.reactionPillAndroidBg}>
              <ReactionPillInner onPick={onPick} theme={theme} />
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

function ReactionPillInner({
  onPick,
  theme
}: {
  onPick: (type: ChatReactionType) => void;
  theme: ReturnType<typeof useDSTheme>;
}): ReactElement {
  const styles = makeStyles(theme);
  return (
    <View style={styles.reactionPillInnerRow}>
      {CHAT_REACTIONS.map((r) => (
        <Pressable
          key={r}
          accessibilityRole="button"
          accessibilityLabel={`React ${r}`}
          onPress={() => onPick(r)}
          style={styles.reactionPillEmojiTouch}
        >
          <Text style={styles.reactionGlyph}>{r}</Text>
        </Pressable>
      ))}
    </View>
  );
}

type MessageBubbleProps = {
  info: ListRenderItemInfo<ChatViewMessage>;
  theme: ReturnType<typeof useDSTheme>;
  memberships: MentionMember[];
  revealed: boolean;
  reactionHighlight: boolean;
  showAvatarTail: boolean;
  onRevealLongPress: (id: string) => void;
  onReleaseReveal: () => void;
  onOpenReactionPicker: (id: string, frame: { x: number; y: number; width: number; height: number }) => void;
  onRetry: (entryId: string) => void;
};

function MessageBubble({
  info,
  theme,
  memberships,
  revealed,
  reactionHighlight,
  showAvatarTail,
  onRevealLongPress,
  onReleaseReveal,
  onOpenReactionPicker,
  onRetry
}: MessageBubbleProps): ReactElement {
  const message = info.item;
  const styles = makeStyles(theme);
  const bubbleRef = useRef<View | null>(null);
  const bubbleColor = message.isOwn ? theme.color.primary : theme.color.card;
  const textColor = message.isOwn ? theme.color.authPrimaryActionText : theme.color.text;
  const ts = formatChatTimestamp(message.sentAt, message.arrivedAt);
  const tokens = parseMentions(message.body ?? "", memberships);

  const bubbleBody = (
    <View
      ref={bubbleRef}
      collapsable={false}
      style={{ alignSelf: message.isOwn ? "flex-end" : "flex-start" }}
    >
      <Pressable
        onLongPress={() => {
          onRevealLongPress(message.id);
          bubbleRef.current?.measureInWindow((x, y, width, height) => {
            onOpenReactionPicker(message.id, { x, y, width, height });
          });
        }}
        onPressOut={() => onReleaseReveal()}
        style={[
          styles.bubble,
          { backgroundColor: bubbleColor },
          reactionHighlight ? styles.bubbleReactionGlow : null
        ]}
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
    </View>
  );

  if (message.isOwn) {
    return (
      <View style={styles.messageRowOwn}>
        {bubbleBody}
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
      </View>
    );
  }

  return (
    <View style={styles.peerMessageOuter}>
      <View style={styles.avatarColumn}>
        {showAvatarTail ? (
          message.authorAvatarUrl ? (
            <Image source={{ uri: message.authorAvatarUrl }} style={styles.peerAvatarImg} />
          ) : (
            <View style={styles.peerAvatarPlaceholder}>
              <Ionicons name="person" size={16} color={theme.color.muted} />
            </View>
          )
        ) : null}
      </View>
      <View style={styles.peerTextColumn}>
        <Text style={styles.author}>{message.authorDisplayName}</Text>
        {bubbleBody}
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
      </View>
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

function streamUserImage(user: MessageResponse["user"]): string | undefined {
  if (!user || typeof user !== "object") return undefined;
  const img = (user as { image?: string }).image;
  return typeof img === "string" && img.trim() !== "" ? img.trim() : undefined;
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
  const authorAvatarUrl = streamUserImage(message.user);
  return {
    id: message.id!,
    isOwn: authorId === viewerStreamUserId,
    authorUserId: authorId,
    authorDisplayName,
    authorAvatarUrl,
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
  let winner: ChatViewMessage;
  if (a.isPending !== b.isPending) winner = a.isPending ? b : a;
  else if (a.isFailed !== b.isFailed) winner = a.isFailed ? b : a;
  else if (Boolean((a.body ?? "").trim()) !== Boolean((b.body ?? "").trim())) {
    winner = Boolean((a.body ?? "").trim()) ? a : b;
  } else winner = b;
  const other = winner === a ? b : a;
  return { ...winner, authorAvatarUrl: winner.authorAvatarUrl ?? other.authorAvatarUrl };
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
      paddingTop: 4,
      gap: 8
    },
    center: { justifyContent: "center", alignItems: "center" },
    title: { color: theme.color.text, fontSize: 18, fontWeight: "700" },
    body: { color: theme.color.body, fontSize: 14 },
    iconButton: { padding: 8 },
    /** Row: scrollable transcript + fixed-width strip so the indicator reads as outside bubble alignment (see SCROLLBAR_*). */
    listWrap: { flex: 1, flexDirection: "row", position: "relative", minHeight: 0 },
    historyLoading: {
      ...StyleSheet.absoluteFillObject,
      alignItems: "center",
      justifyContent: "center",
      gap: 12,
      zIndex: 2,
      backgroundColor: theme.color.background
    },
    historyLoadingText: { color: theme.color.muted, fontSize: 14 },
    listFlatList: { flex: 1, minWidth: 0 },
    scrollGutterStrip: { flexShrink: 0, alignSelf: "stretch" },
    listContent: { gap: 6, paddingVertical: 12 },
    oldPageLoading: { paddingVertical: 10, alignItems: "center", justifyContent: "center" },
    unseenChipWrap: {
      position: "absolute",
      bottom: 10,
      left: 0,
      right: 0,
      alignItems: "center",
      justifyContent: "center"
    },
    unseenChip: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      paddingVertical: 10,
      paddingHorizontal: 16,
      borderRadius: 999,
      backgroundColor: theme.color.primary
    },
    unseenChipText: {
      color: theme.color.authPrimaryActionText,
      fontWeight: "600",
      fontSize: 13
    },
    emptyCard: { padding: 16 },
    errorCard: { padding: 12, borderColor: theme.color.danger, borderWidth: 1 },
    banner: { backgroundColor: theme.color.warning, padding: 12 },
    bannerText: { color: theme.color.text, fontSize: 13 },
    messageRowOwn: {
      alignSelf: "flex-end",
      maxWidth: "88%",
      alignItems: "flex-end",
      marginVertical: 2,
      gap: 4
    },
    peerMessageOuter: {
      flexDirection: "row",
      alignItems: "flex-end",
      alignSelf: "flex-start",
      maxWidth: "88%",
      marginVertical: 2
    },
    avatarColumn: {
      width: 28,
      marginRight: 8,
      justifyContent: "flex-end",
      alignItems: "center",
      alignSelf: "flex-end"
    },
    peerAvatarImg: { width: 28, height: 28, borderRadius: 14 },
    peerAvatarPlaceholder: {
      width: 28,
      height: 28,
      borderRadius: 14,
      backgroundColor: theme.color.card,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.color.divider,
      alignItems: "center",
      justifyContent: "center"
    },
    peerTextColumn: { flexShrink: 1, gap: 4, maxWidth: "100%" },
    bubble: { padding: 10, borderRadius: 14 },
    bubbleReactionGlow: Platform.select({
      ios: {
        shadowColor: theme.color.primary,
        shadowOpacity: 0.72,
        shadowRadius: 11,
        shadowOffset: { width: 0, height: 0 }
      },
      default: {
        elevation: 10,
        shadowColor: theme.color.primary
      }
    }),
    bubbleImage: { width: 200, height: 200, borderRadius: 8, marginBottom: 6 },
    author: { color: theme.color.muted, fontSize: 12 },
    progressBar: { marginTop: 4 },
    retry: { fontSize: 12, marginTop: 4 },
    timestampReveal: { padding: 4 },
    timestampText: { color: theme.color.muted, fontSize: 11 },
    reactionsRow: { flexDirection: "row", gap: 6, paddingHorizontal: 4, flexWrap: "wrap" },
    reactionChip: { color: theme.color.text, fontSize: 12 },
    reactionGlyph: { fontSize: 22 },
    reactionOverlayRoot: { flex: 1 },
    reactionPillOuter: {
      position: "absolute",
      borderRadius: 999,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: "rgba(255,255,255,0.22)"
    },
    reactionPillBlur: {
      borderRadius: 999,
      overflow: "hidden",
      paddingHorizontal: 2,
      paddingVertical: 4
    },
    reactionPillAndroidBg: {
      backgroundColor: "rgba(36,36,40,0.94)",
      borderRadius: 999,
      paddingHorizontal: 2,
      paddingVertical: 4
    },
    reactionPillInnerRow: { flexDirection: "row", alignItems: "center", justifyContent: "center" },
    reactionPillEmojiTouch: { paddingHorizontal: 6, paddingVertical: 2 },
    composer: { gap: 6, paddingBottom: 8 },
    composerError: { color: theme.color.danger, fontSize: 13, lineHeight: 18 },
    composerRow: { flexDirection: "row", alignItems: "center", gap: 6 },
    composerInput: {
      flex: 1,
      minHeight: 48,
      maxHeight: 160,
      paddingVertical: Platform.OS === "ios" ? 13 : 10,
      lineHeight: 22,
      fontSize: 16
    },
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
    /** In-list footer: sits under the last bubble inside `FlatList`, right-aligned (LTR). */
    readByListFooter: {
      alignSelf: "stretch",
      alignItems: "flex-end",
      paddingTop: 4,
      paddingBottom: 2
    },
    readByListFooterText: { color: theme.color.muted, fontSize: 11 }
  });
}
