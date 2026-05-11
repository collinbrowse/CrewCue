/** Newest messages to fetch first (watch + prefetch + transcript cache tail). */
export const CHAT_INITIAL_MESSAGE_COUNT = 10;

/** Older history loaded when the user scrolls toward the top. */
export const CHAT_HISTORY_PAGE_SIZE = 40;

/** Scroll offset from the top (px) at which we request the next older page. */
export const CHAT_SCROLL_LOAD_MORE_PX = 120;
