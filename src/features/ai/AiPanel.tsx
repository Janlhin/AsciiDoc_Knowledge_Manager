import { useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "@app/AppContext";
import { Icon } from "@app/icons";
import { useI18n } from "@core/i18n";
import { streamChat } from "@core/llm/client";
import { capContext, splitCodeFences } from "@core/llm/sse";
import {
  activeLlmProviderId,
  isProviderUsable,
  llmProviders,
  resolveActiveProvider,
  setActiveLlmProvider,
} from "@core/llm/store";
import type { ChatMessage, LlmProvider } from "@core/llm/types";
import { usesOsCredentialStore } from "@core/llm/secrets";
import { useStore } from "@core/store";
import { findActiveTab } from "@core/workspace";
import { requestSettingsSection } from "@core/settingsNav";
import "./ai.scss";

/** Characters of the active note sent as context. ~3k tokens of CJK/English. */
const MAX_CONTEXT_CHARS = 12_000;
/** Skip context for very large notes (the user has files up to 50 MB). */
const MAX_CONTEXT_SOURCE = 2_000_000;

function basename(path: string): string {
  const idx = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return idx >= 0 ? path.slice(idx + 1) : path;
}

function AssistantBody({ text, streaming }: { text: string; streaming: boolean }) {
  const segments = useMemo(() => splitCodeFences(text), [text]);
  return (
    <div className="ai-msg-body">
      {segments.map((segment, index) =>
        segment.kind === "code" ? (
          <pre className="ai-code" key={index} data-lang={segment.lang}>
            <code>{segment.content}</code>
          </pre>
        ) : (
          <div className="ai-text" key={index}>
            {segment.content}
          </div>
        ),
      )}
      {streaming && text === "" && <div className="ai-text ai-thinking">…</div>}
    </div>
  );
}

export function AiPanel() {
  const app = useApp();
  const t = useI18n();
  const providers = useStore(llmProviders);
  const activeProviderId = useStore(activeLlmProviderId);
  const provider = resolveActiveProvider(providers, activeProviderId);

  const ws = useStore(app.workspace.state);
  const lastActive = useStore(app.workspace.lastActiveFile);
  const activeTab = findActiveTab(ws);
  const activePath = activeTab?.viewType === "markdown" ? activeTab.filePath : lastActive;

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [includeNote, setIncludeNote] = useState(true);
  const [contextTruncated, setContextTruncated] = useState(false);
  const [contextSkipped, setContextSkipped] = useState(false);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = scrollRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [messages, streaming]);

  // Stop the in-flight request when the panel unmounts (tab switch / sidebar close).
  useEffect(() => () => abortRef.current?.abort(), []);

  const canSend =
    !streaming && input.trim() !== "" && provider !== null && isProviderUsable(provider);

  const openSettings = () => {
    requestSettingsSection("ai");
    app.workspace.openModal("settings");
  };

  const clear = () => {
    abortRef.current?.abort();
    setMessages([]);
    setError(null);
    setCopiedIndex(null);
    setContextTruncated(false);
    setContextSkipped(false);
  };

  const copy = (index: number, text: string) => {
    void navigator.clipboard
      ?.writeText(text)
      .then(() => {
        setCopiedIndex(index);
        window.setTimeout(() => setCopiedIndex((cur) => (cur === index ? null : cur)), 1500);
      })
      .catch(() => {});
  };

  const send = async () => {
    const text = input.trim();
    if (text === "" || streaming) return;
    if (provider === null || !isProviderUsable(provider)) {
      openSettings();
      return;
    }

    setInput("");
    setError(null);
    setContextTruncated(false);
    setContextSkipped(false);
    setStreaming(true);

    // Context: cached content first (the open editor usually has it), then a
    // guarded read. Oversized notes are skipped rather than parsed wholesale.
    let noteContext = "";
    if (includeNote && activePath !== null) {
      const length = app.metadata.getMetadata(activePath)?.contentLength ?? 0;
      if (length > MAX_CONTEXT_SOURCE) {
        setContextSkipped(true);
      } else {
        const cached = app.vault.readCached(activePath);
        const raw = cached ?? (await app.vault.read(activePath).catch(() => ""));
        const capped = capContext(raw, MAX_CONTEXT_CHARS);
        noteContext = capped.text;
        setContextTruncated(capped.truncated);
      }
    }

    const userMessage: ChatMessage = { role: "user", content: text };
    const history = [...messages, userMessage];
    const request: ChatMessage[] = [
      { role: "system", content: t("ai.systemPrompt") },
      ...(noteContext !== ""
        ? [{ role: "system" as const, content: `${t("ai.contextHeader")}\n\n${noteContext}` }]
        : []),
      ...history,
    ];

    const controller = new AbortController();
    abortRef.current = controller;
    setMessages([...history, { role: "assistant", content: "" }]);

    let accumulated = "";
    try {
      await streamChat({
        provider,
        messages: request,
        signal: controller.signal,
        onDelta: (delta) => {
          accumulated += delta;
          setMessages((prev) => {
            const next = [...prev];
            next[next.length - 1] = { role: "assistant", content: accumulated };
            return next;
          });
        },
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      // Remove an empty placeholder so a failed request leaves no blank bubble.
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        return last?.role === "assistant" && last.content === ""
          ? prev.slice(0, -1)
          : prev;
      });
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  };

  const stop = () => {
    abortRef.current?.abort();
  };

  const selectProvider = (next: LlmProvider | undefined) => {
    if (next !== undefined) setActiveLlmProvider(next.id);
  };

  const hasProvider = provider !== null && isProviderUsable(provider);

  return (
    <div className="ai-panel" data-testid="ai-panel">
      <div className="panel-header ai-header">
        <span>{t("ai.title")}</span>
        <div className="ai-header-actions">
          {providers.length > 0 && (
            <select
              className="ai-provider-select"
              data-testid="ai-provider-select"
              aria-label={t("ai.providerAria")}
              value={provider?.id ?? ""}
              onChange={(e) => {
                selectProvider(providers.find((p) => p.id === e.target.value));
              }}
            >
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          )}
          <button
            className="ai-icon-btn"
            data-testid="ai-open-settings"
            title={t("ai.settings")}
            aria-label={t("ai.settings")}
            onClick={openSettings}
          >
            <Icon name="settings" size={14} />
          </button>
          {messages.length > 0 && (
            <button className="ai-text-btn" onClick={clear} title={t("ai.clear")}>
              {t("ai.clear")}
            </button>
          )}
        </div>
      </div>

      <label className="ai-context-bar" data-testid="ai-context-bar">
        <input
          type="checkbox"
          checked={includeNote && activePath !== null}
          disabled={activePath === null}
          onChange={(e) => setIncludeNote(e.target.checked)}
        />
        <span>{t("ai.includeNote")}</span>
        {activePath !== null ? (
          <span className="ai-context-path" title={activePath}>
            {basename(activePath)}
          </span>
        ) : (
          <span className="ai-context-path">{t("ai.noNote")}</span>
        )}
      </label>
      {(contextTruncated || contextSkipped) && (
        <div className="ai-context-note" data-testid="ai-context-note">
          {contextSkipped ? t("ai.contextSkipped") : t("ai.contextTruncated")}
        </div>
      )}

      <div className="ai-messages" ref={scrollRef} data-testid="ai-messages">
        {messages.length === 0 ? (
          <div className="ai-empty" data-testid="ai-empty">
            <div className="ai-empty-title">{t("ai.emptyTitle")}</div>
            <div className="ai-empty-body">{t("ai.emptyBody")}</div>
            {!hasProvider && (
              <button className="ai-primary" onClick={openSettings}>
                {t("ai.configure")}
              </button>
            )}
          </div>
        ) : (
          messages.map((message, index) => (
            <div
              key={index}
              className={`ai-msg ai-msg-${message.role}`}
              data-testid={`ai-msg-${message.role}`}
            >
              <div className="ai-msg-role">
                {message.role === "user" ? t("ai.you") : t("ai.assistant")}
                {message.role === "assistant" && message.content !== "" && (
                  <button
                    className="ai-copy-btn"
                    title={t("ai.copy")}
                    onClick={() => copy(index, message.content)}
                  >
                    {copiedIndex === index ? t("ai.copied") : t("ai.copy")}
                  </button>
                )}
              </div>
              {message.role === "user" ? (
                <div className="ai-text">{message.content}</div>
              ) : (
                <AssistantBody
                  text={message.content}
                  streaming={streaming && index === messages.length - 1}
                />
              )}
            </div>
          ))
        )}
      </div>

      {error !== null && (
        <div className="ai-error" data-testid="ai-error">
          {t("ai.errorPrefix")}
          {error}
        </div>
      )}

      <div className="ai-composer">
        <textarea
          className="ai-input"
          data-testid="ai-input"
          value={input}
          placeholder={hasProvider ? t("ai.placeholder") : t("ai.noProviderBody")}
          rows={3}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <div className="ai-composer-actions">
          <span className="ai-hint">{t("ai.sendHint")}</span>
          {streaming ? (
            <button className="ai-primary" data-testid="ai-stop" onClick={stop}>
              {t("ai.stop")}
            </button>
          ) : (
            <button
              className="ai-primary"
              data-testid="ai-send"
              disabled={!canSend}
              onClick={() => void send()}
            >
              {t("ai.send")}
            </button>
          )}
        </div>
      </div>

      <div className="ai-footer">
        {usesOsCredentialStore() ? t("ai.privacyOs") : t("ai.privacyBrowser")}
      </div>
    </div>
  );
}
