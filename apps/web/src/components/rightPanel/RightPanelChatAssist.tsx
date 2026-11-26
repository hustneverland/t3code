import type { FilePreviewSelection } from "@t3tools/shared/htmlRender";
import * as Schema from "effect/Schema";
import { useGT } from "gt-react";
import {
  ChevronDownIcon,
  ChevronUpIcon,
  FileTextIcon,
  GlobeIcon,
  MessageSquareIcon,
  QuoteIcon,
  SendHorizontalIcon,
  XIcon,
} from "lucide-react";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import { useComposerHandleContext } from "~/composerHandleContext";
import { useLocalStorage } from "~/hooks/useLocalStorage";
import { Button } from "~/components/ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { toastManager } from "~/components/ui/toast";
import { cn } from "~/lib/utils";
import {
  computeSelectionPopoverPosition,
  formatRightPanelQuoteForChat,
  formatRightPanelSourceLabel,
  type RightPanelChatSource,
  type SelectionAnchorRect,
} from "./rightPanelQuote";

const RIGHT_PANEL_QUICK_CHAT_STORAGE_KEY = "t3code.rightPanelQuickChatOpen";
const SELECTION_MAX_CHARS = 4_000;
const POPOVER_PILL_FALLBACK_SIZE = { width: 210, height: 34 };
const POPOVER_ASK_FALLBACK_SIZE = { width: 320, height: 76 };

interface ActiveSelection {
  readonly text: string;
  readonly anchor: SelectionAnchorRect;
  readonly origin: "dom" | "iframe";
}

function isEditableElement(node: Node | null): boolean {
  const element = node instanceof Element ? node : node?.parentElement;
  if (!element) return false;
  if (element.closest("[data-right-panel-assist]")) return true;
  if (element.closest("input, textarea, select")) return true;
  return element instanceof HTMLElement && element.isContentEditable;
}

function readDomSelectionInContainer(container: HTMLElement): ActiveSelection | null {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  const text = selection.toString().trim();
  if (text.length === 0) return null;
  if (isEditableElement(selection.anchorNode) || isEditableElement(selection.focusNode)) {
    return null;
  }
  const range = selection.getRangeAt(0);
  const common = range.commonAncestorContainer;
  if (!container.contains(common)) return null;
  let rect = range.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) {
    const firstRect = range.getClientRects()[0];
    if (!firstRect) return null;
    rect = firstRect;
  }
  return {
    text: text.slice(0, SELECTION_MAX_CHARS),
    anchor: { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
    origin: "dom",
  };
}

function isImeConfirmEvent(event: ReactKeyboardEvent<HTMLInputElement>): boolean {
  return event.nativeEvent.isComposing || event.keyCode === 229;
}

export function RightPanelSelectionPopover(props: {
  readonly containerRef: RefObject<HTMLElement | null>;
  readonly source: RightPanelChatSource;
  readonly externalSelection?: FilePreviewSelection | null | undefined;
  readonly onClearExternalSelection?: (() => void) | undefined;
}) {
  const gt = useGT();
  const composerRef = useComposerHandleContext();
  const popoverRef = useRef<HTMLDivElement>(null);
  const askInputRef = useRef<HTMLInputElement>(null);

  const [domSelection, setDomSelection] = useState<ActiveSelection | null>(null);
  const [askTarget, setAskTarget] = useState<ActiveSelection | null>(null);
  const [askQuestion, setAskQuestion] = useState("");
  const [popoverSize, setPopoverSize] = useState(POPOVER_PILL_FALLBACK_SIZE);

  const iframeSelection: ActiveSelection | null =
    props.externalSelection && props.externalSelection.text.length > 0
      ? {
          text: props.externalSelection.text,
          anchor: {
            x: props.externalSelection.x,
            y: props.externalSelection.y,
            width: props.externalSelection.width,
            height: props.externalSelection.height,
          },
          origin: "iframe",
        }
      : null;

  const activeSelection = askTarget ?? iframeSelection ?? domSelection;
  const isAskMode = askTarget !== null;

  const dismissAll = useEffectEvent(() => {
    setAskTarget(null);
    setAskQuestion("");
    setDomSelection(null);
    props.onClearExternalSelection?.();
  });

  const syncDomSelection = useEffectEvent(() => {
    const container = props.containerRef.current;
    if (!container) {
      setDomSelection(null);
      return;
    }
    const next = readDomSelectionInContainer(container);
    setDomSelection(next);
  });

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- listens to document selection and container scroll to position the floating quote popover
  useEffect(() => {
    if (!composerRef) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const scheduleSync = () => {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        syncDomSelection();
      }, 30);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismissAll();
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && popoverRef.current?.contains(target)) return;
      if (askTarget !== null) {
        dismissAll();
      }
    };
    document.addEventListener("mouseup", scheduleSync, { passive: true });
    document.addEventListener("keyup", scheduleSync, { passive: true });
    document.addEventListener("selectionchange", scheduleSync, { passive: true });
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      if (timer !== null) clearTimeout(timer);
      document.removeEventListener("mouseup", scheduleSync);
      document.removeEventListener("keyup", scheduleSync);
      document.removeEventListener("selectionchange", scheduleSync);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [askTarget, composerRef]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- measures the rendered popover box to keep it clamped within the viewport
  useLayoutEffect(() => {
    if (!activeSelection) return;
    const element = popoverRef.current;
    if (!element) return;
    const fallback = isAskMode ? POPOVER_ASK_FALLBACK_SIZE : POPOVER_PILL_FALLBACK_SIZE;
    const rect = element.getBoundingClientRect();
    const width = Math.max(rect.width, fallback.width);
    const height = Math.max(rect.height, fallback.height);
    setPopoverSize((current) =>
      Math.abs(current.width - width) < 1 && Math.abs(current.height - height) < 1
        ? current
        : { width, height },
    );
  }, [activeSelection, isAskMode]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- focuses the inline ask input when switching from pill mode to ask mode
  useEffect(() => {
    if (isAskMode) {
      askInputRef.current?.focus();
    }
  }, [isAskMode]);

  if (!composerRef || !activeSelection) return null;

  const fallbackSize = isAskMode ? POPOVER_ASK_FALLBACK_SIZE : POPOVER_PILL_FALLBACK_SIZE;
  const measuredSize = {
    width: Math.max(popoverSize.width, fallbackSize.width),
    height: Math.max(popoverSize.height, fallbackSize.height),
  };
  const position = computeSelectionPopoverPosition(
    activeSelection.anchor,
    { width: window.innerWidth, height: window.innerHeight },
    measuredSize,
  );

  const insertQuoteToComposer = (question?: string) => {
    const composer = composerRef.current;
    if (!composer) {
      toastManager.add({
        type: "error",
        title: gt("Unable to quote into chat"),
        description: gt("Open a chat first and try again."),
      });
      return;
    }
    const payload = formatRightPanelQuoteForChat({
      source: props.source,
      selectedText: activeSelection.text,
      question,
    });
    const inserted = composer.insertTextAtEnd(payload, { ensureLeadingBoundary: true });
    if (!inserted) {
      toastManager.add({
        type: "error",
        title: gt("Unable to quote into chat"),
        description: gt("The composer is busy; try again once it is ready."),
      });
      return;
    }
    composer.focusAtEnd();
    if (activeSelection.origin === "dom") {
      window.getSelection()?.removeAllRanges();
    }
    dismissAll();
  };

  const sendSelectionToCurrentChat = () => {
    const composer = composerRef.current;
    if (!composer) {
      toastManager.add({
        type: "error",
        title: gt("Unable to send to current chat"),
        description: gt("Open a chat first and try again."),
      });
      return;
    }
    const payload = formatRightPanelQuoteForChat({
      source: props.source,
      selectedText: activeSelection.text,
      question: askQuestion,
    });
    const sent = composer.submitTextAtEnd(payload, { ensureLeadingBoundary: true });
    if (!sent) {
      toastManager.add({
        type: "error",
        title: gt("Unable to send to current chat"),
        description: gt("The composer is busy; try again once it is ready."),
      });
      return;
    }
    if (activeSelection.origin === "dom") {
      window.getSelection()?.removeAllRanges();
    }
    dismissAll();
  };

  return createPortal(
    <div
      ref={popoverRef}
      data-right-panel-assist
      style={{ left: `${position.left}px`, top: `${position.top}px` }}
      className={cn(
        "fixed z-60 rounded-lg border border-border bg-popover text-popover-foreground shadow-lg",
        isAskMode ? "w-80 max-w-[calc(100vw-16px)] p-2" : "flex items-center gap-0.5 p-1",
      )}
    >
      {isAskMode ? (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-1.5 text-2xs text-muted-foreground">
            <QuoteIcon className="size-3 shrink-0" />
            <span className="min-w-0 flex-1 truncate">{activeSelection.text}</span>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              onClick={dismissAll}
              aria-label={gt("Dismiss quote")}
            >
              <XIcon className="size-3" />
            </Button>
          </div>
          <div className="flex items-center gap-1">
            <input
              ref={askInputRef}
              type="text"
              value={askQuestion}
              onChange={(event) => setAskQuestion(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  dismissAll();
                  return;
                }
                if (event.key === "Enter" && !isImeConfirmEvent(event)) {
                  event.preventDefault();
                  if (event.shiftKey) {
                    insertQuoteToComposer(askQuestion);
                  } else {
                    sendSelectionToCurrentChat();
                  }
                }
              }}
              placeholder={gt("Ask in current chat…")}
              aria-label={gt("Ask in current chat")}
              className="h-7 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-ring"
            />
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => insertQuoteToComposer(askQuestion)}
                    aria-label={gt("Insert into composer")}
                  />
                }
              >
                <QuoteIcon className="size-3.5" />
              </TooltipTrigger>
              <TooltipPopup>{gt("Insert into composer")}</TooltipPopup>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    type="button"
                    variant="default"
                    size="icon-xs"
                    onClick={sendSelectionToCurrentChat}
                    aria-label={gt("Send to current chat")}
                  />
                }
              >
                <SendHorizontalIcon className="size-3.5" />
              </TooltipTrigger>
              <TooltipPopup>{gt("Send to current chat")}</TooltipPopup>
            </Tooltip>
          </div>
        </div>
      ) : (
        <>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => insertQuoteToComposer()}
          >
            <QuoteIcon className="size-3.5" />
            <span>{gt("Quote to chat")}</span>
          </Button>
          <div className="mx-0.5 h-3.5 w-px bg-border" />
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => setAskTarget(activeSelection)}
          >
            <MessageSquareIcon className="size-3.5" />
            <span>{gt("Ask in chat")}</span>
          </Button>
        </>
      )}
    </div>,
    document.body,
  );
}

export function RightPanelQuickChatBar(props: {
  readonly source: RightPanelChatSource;
  readonly className?: string | undefined;
}) {
  const gt = useGT();
  const composerRef = useComposerHandleContext();
  const [expanded, setExpanded] = useLocalStorage(
    RIGHT_PANEL_QUICK_CHAT_STORAGE_KEY,
    true,
    Schema.Boolean,
  );
  const [includeSource, setIncludeSource] = useState(true);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  if (!composerRef) return null;

  const sourceLabel = formatRightPanelSourceLabel(props.source);
  const SourceIcon = props.source.kind === "file" ? FileTextIcon : GlobeIcon;

  const handleInsertIntoComposer = () => {
    const composer = composerRef.current;
    if (!composer) {
      toastManager.add({
        type: "error",
        title: gt("Unable to quote into chat"),
        description: gt("Open a chat first and try again."),
      });
      return;
    }
    const payload = formatRightPanelQuoteForChat({
      source: props.source,
      question: draft,
      includeSource: includeSource || draft.trim().length === 0,
    });
    if (payload.length === 0) return;
    const inserted = composer.insertTextAtEnd(payload, { ensureLeadingBoundary: true });
    if (!inserted) {
      toastManager.add({
        type: "error",
        title: gt("Unable to quote into chat"),
        description: gt("The composer is busy; try again once it is ready."),
      });
      return;
    }
    setDraft("");
    composer.focusAtEnd();
  };

  const handleSendToCurrentChat = () => {
    const trimmed = draft.trim();
    if (trimmed.length === 0) return;
    const composer = composerRef.current;
    if (!composer) {
      toastManager.add({
        type: "error",
        title: gt("Unable to send to current chat"),
        description: gt("Open a chat first and try again."),
      });
      return;
    }
    const payload = formatRightPanelQuoteForChat({
      source: props.source,
      question: trimmed,
      includeSource,
    });
    const sent = composer.submitTextAtEnd(payload, { ensureLeadingBoundary: true });
    if (!sent) {
      toastManager.add({
        type: "error",
        title: gt("Unable to send to current chat"),
        description: gt("The composer is busy; try again once it is ready."),
      });
      return;
    }
    setDraft("");
  };

  if (!expanded) {
    return (
      <div
        data-right-panel-assist
        className={cn(
          "flex h-7 shrink-0 items-center justify-between gap-2 border-t border-border/60 bg-background px-2.5",
          props.className,
        )}
      >
        <button
          type="button"
          onClick={() => {
            setExpanded(true);
            requestAnimationFrame(() => inputRef.current?.focus());
          }}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-2xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <MessageSquareIcon className="size-3 shrink-0" />
          <span className="truncate">{gt("Continue in current chat…")}</span>
        </button>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                onClick={() => setExpanded(true)}
                aria-label={gt("Show quick chat bar")}
              />
            }
          >
            <ChevronUpIcon className="size-3.5" />
          </TooltipTrigger>
          <TooltipPopup>{gt("Show quick chat bar")}</TooltipPopup>
        </Tooltip>
      </div>
    );
  }

  return (
    <div
      data-right-panel-assist
      className={cn(
        "flex shrink-0 items-center gap-1.5 border-t border-border/60 bg-background px-2 py-1.5",
        props.className,
      )}
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              onClick={() => setIncludeSource((value) => !value)}
              aria-pressed={includeSource}
              className={cn(
                "flex h-7 max-w-36 shrink-0 items-center gap-1 rounded-md border px-2 text-2xs transition-colors",
                includeSource
                  ? "border-border bg-secondary/70 text-foreground"
                  : "border-transparent bg-transparent text-muted-foreground hover:border-border/60 hover:text-foreground",
              )}
            />
          }
        >
          <SourceIcon className="size-3 shrink-0" />
          <span className="truncate">{sourceLabel}</span>
        </TooltipTrigger>
        <TooltipPopup>
          {includeSource
            ? gt("Attached as context · Click to exclude")
            : gt("Context excluded · Click to attach")}
        </TooltipPopup>
      </Tooltip>

      <input
        ref={inputRef}
        type="text"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !isImeConfirmEvent(event)) {
            event.preventDefault();
            if (event.shiftKey) {
              handleInsertIntoComposer();
            } else {
              handleSendToCurrentChat();
            }
          }
        }}
        placeholder={gt("Continue in current chat…")}
        aria-label={gt("Continue in current chat")}
        className="h-7 min-w-0 flex-1 rounded-md border border-input bg-background px-2.5 text-xs text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-ring"
      />

      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              onClick={handleInsertIntoComposer}
              aria-label={gt("Insert reference into composer")}
            />
          }
        >
          <QuoteIcon className="size-3.5" />
        </TooltipTrigger>
        <TooltipPopup>{gt("Insert reference into composer")}</TooltipPopup>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              variant="default"
              size="icon-xs"
              disabled={draft.trim().length === 0}
              onClick={handleSendToCurrentChat}
              aria-label={gt("Send to current chat")}
            />
          }
        >
          <SendHorizontalIcon className="size-3.5" />
        </TooltipTrigger>
        <TooltipPopup>{gt("Send to current chat")}</TooltipPopup>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              onClick={() => setExpanded(false)}
              aria-label={gt("Hide quick chat bar")}
            />
          }
        >
          <ChevronDownIcon className="size-3.5" />
        </TooltipTrigger>
        <TooltipPopup>{gt("Hide quick chat bar")}</TooltipPopup>
      </Tooltip>
    </div>
  );
}
