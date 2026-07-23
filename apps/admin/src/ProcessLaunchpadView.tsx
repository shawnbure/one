import { useEffect, useMemo, useState } from "react";
import { Archive, Bot, Clock3, MessageSquare, Plus, Send, Sparkles, Workflow } from "lucide-react";
import type { AgentBlueprint } from "@workrr/contracts";
import { api, type LaunchpadMessage, type LaunchpadThread, type SessionData } from "./api";
import "./process-launchpad.css";

export function ProcessLaunchpadView({
  processes,
  session,
  onNotice,
}: {
  processes: AgentBlueprint[];
  session: SessionData | null;
  onNotice: (message: string) => void;
}) {
  const available = useMemo(
    () => processes.filter((process) =>
      process.status === "active" && process.activeReleaseId &&
      !["entity", "shared_shard"].includes(process.executionProfile)),
    [processes],
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [threads, setThreads] = useState<LaunchpadThread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<LaunchpadMessage[]>([]);
  const [title, setTitle] = useState("");
  const [input, setInput] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const selected = available.find((process) => process.id === selectedId) ?? available[0] ?? null;
  const activeThread = threads.find((thread) => thread.id === activeThreadId) ?? null;
  const isConversation = selected?.executionProfile === "conversation";

  useEffect(() => {
    if (!selectedId && available[0]) setSelectedId(available[0].id);
  }, [available, selectedId]);

  useEffect(() => {
    setInput("");
    setResult(null);
    setMessages([]);
    setActiveThreadId(null);
    if (!selected || selected.executionProfile !== "conversation") {
      setThreads([]);
      return;
    }
    void loadThreads(selected.id);
  }, [selected?.id]);

  async function loadThreads(blueprintId: string, preferredId?: string) {
    try {
      const response = await api.launchpadThreads(blueprintId);
      setThreads(response.data);
      const nextId = preferredId ??
        response.data.find((thread) => thread.status === "active")?.id ??
        response.data[0]?.id ?? null;
      setActiveThreadId(nextId);
      if (nextId) await loadConversation(nextId);
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Conversations could not be loaded");
    }
  }

  async function loadConversation(threadId: string) {
    setBusy(`load:${threadId}`);
    try {
      const response = await api.launchpadConversation(threadId);
      setMessages(response.data.messages);
      setActiveThreadId(threadId);
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Conversation could not be loaded");
    } finally {
      setBusy(null);
    }
  }

  async function createThread(event: React.FormEvent) {
    event.preventDefault();
    if (!selected) return;
    setBusy("create");
    try {
      const response = await api.createLaunchpadThread(selected.id, title);
      setTitle("");
      await loadThreads(selected.id, response.data.id);
      onNotice("Private conversation created.");
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Conversation could not be created");
    } finally {
      setBusy(null);
    }
  }

  async function run(event: React.FormEvent) {
    event.preventDefault();
    if (!selected || !input.trim()) return;
    setBusy("run");
    setResult(null);
    try {
      if (isConversation) {
        if (!activeThread) throw new Error("Create a conversation before sending a message");
        const response = await api.sendLaunchpadMessage(activeThread.id, input.trim());
        setInput("");
        await loadConversation(activeThread.id);
        if (!response.data.output) {
          setResult(statusMessage(response.data.status, response.data.executionId));
        }
        setThreads((current) => current.map((thread) => thread.id === activeThread.id
          ? { ...thread, last_execution_id: response.data.executionId, updated_at: new Date().toISOString() }
          : thread));
      } else {
        const response = await api.runLaunchpadProcess(selected.id, input.trim());
        setResult(response.data.output ?? statusMessage(response.data.status, response.data.executionId));
      }
    } catch (error) {
      setResult(error instanceof Error ? error.message : "Process could not be run");
    } finally {
      setBusy(null);
    }
  }

  async function archiveThread() {
    if (!selected || !activeThread) return;
    setBusy("archive");
    try {
      const archived = activeThread.status === "active";
      await api.archiveLaunchpadThread(activeThread.id, archived);
      await loadThreads(selected.id, activeThread.id);
      onNotice(archived ? "Conversation archived. Its memory is retained under policy." : "Conversation reopened.");
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Conversation could not be updated");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="launchpad-page">
      <header className="launchpad-title">
        <span><Sparkles size={16} /> EMPLOYEE AI WORKSPACE</span>
        <h1>Process launchpad</h1>
        <p>Use approved AI processes without needing to understand models, prompts, or infrastructure.</p>
      </header>
      <div className="launchpad-layout">
        <aside className="panel launchpad-processes">
          <div className="panel-head"><div><h2>Available processes</h2><p>{available.length} ready for use</p></div></div>
          {available.map((process) => (
            <button className={selected?.id === process.id ? "selected" : ""} key={process.id}
              onClick={() => setSelectedId(process.id)}>
              <span className={`launchpad-process-icon ${process.executionProfile}`}>
                {process.executionProfile === "conversation" ? <MessageSquare size={18} /> : <Workflow size={18} />}
              </span>
              <span><strong>{process.name}</strong><small>{process.description}</small>
                <em>{profileLabel(process.executionProfile)}</em></span>
            </button>
          ))}
          {!available.length && <div className="launchpad-empty"><Bot size={22} />
            <strong>No processes are ready</strong><p>An owner must publish and activate a process first.</p></div>}
        </aside>

        <main className="panel launchpad-workspace">
          {selected ? <>
            <header>
              <div><span>{profileLabel(selected.executionProfile)}</span><h2>{selected.name}</h2>
                <p>{selected.description}</p></div>
              <div className="launchpad-trust"><strong>{selected.autonomy}</strong><small>approved autonomy</small></div>
            </header>
            {isConversation ? (
              <div className="conversation-layout">
                <aside className="thread-list">
                  <form onSubmit={createThread}>
                    <label htmlFor="thread-title">New conversation</label>
                    <div><input id="thread-title" maxLength={80} placeholder="Customer or task name"
                      value={title} onChange={(event) => setTitle(event.target.value)} />
                      <button aria-label="Create conversation" disabled={busy === "create"}><Plus size={16} /></button></div>
                  </form>
                  {threads.map((thread) => <button key={thread.id}
                    className={thread.id === activeThreadId ? "selected" : ""}
                    onClick={() => void loadConversation(thread.id)}>
                    <MessageSquare size={15} /><span><strong>{thread.title}</strong>
                      <small>{thread.status} · {new Date(thread.updated_at).toLocaleDateString()}</small></span>
                  </button>)}
                </aside>
                <div className="conversation-panel">
                  {activeThread ? <>
                    <div className="conversation-head"><div><strong>{activeThread.title}</strong>
                      <small><Clock3 size={13} /> Durable Agent memory · private to {session?.user.name ?? "you"}</small></div>
                      <button onClick={() => void archiveThread()} disabled={busy === "archive"}>
                        <Archive size={14} /> {activeThread.status === "active" ? "Archive" : "Reopen"}</button></div>
                    <div className="message-list" aria-live="polite">
                      {!messages.length && <div className="conversation-empty"><MessageSquare size={24} />
                        <strong>Start this conversation</strong>
                        <p>Messages stay with this named Agent actor until retention or an authorized memory action removes them.</p></div>}
                      {messages.map((message, index) => <article className={message.role} key={`${message.created_at}-${index}`}>
                        <small>{message.role === "user" ? "You" : selected.name}</small>
                        <p>{message.content}</p>
                      </article>)}
                    </div>
                  </> : <div className="conversation-empty"><Plus size={24} /><strong>Create a conversation</strong>
                    <p>Each conversation receives an isolated durable Agent actor.</p></div>}
                </div>
              </div>
            ) : <div className="instant-context"><Workflow size={20} /><span><strong>{profileLabel(selected.executionProfile)}</strong>
              <small>{memoryExplanation(selected.executionProfile)}</small></span></div>}
            {result && <div className="launchpad-result"><Sparkles size={16} /><p>{result}</p></div>}
            <form className="launchpad-composer" onSubmit={run}>
              <label htmlFor="launchpad-input">{isConversation ? "Message" : "Process input"}</label>
              <textarea id="launchpad-input" maxLength={50_000} rows={4}
                placeholder={selected.inputSchemaJson ? "Enter the required JSON input…" : "Describe the work and include the facts this process needs…"}
                value={input} onChange={(event) => setInput(event.target.value)} />
              <footer><small>Input and output pass through tenant DLP, release contracts, and audit controls.</small>
                <button className="primary" disabled={busy === "run" || !input.trim() ||
                  (isConversation && activeThread?.status !== "active")}>
                  <Send size={16} /> {busy === "run" ? "Working…" : isConversation ? "Send" : "Run process"}
                </button></footer>
            </form>
          </> : <div className="launchpad-empty"><Bot size={28} /><strong>No runnable processes</strong>
            <p>Published active processes will appear here.</p></div>}
        </main>
      </div>
    </section>
  );
}

function profileLabel(profile: string) {
  if (profile === "conversation") return "Threaded conversation";
  if (profile === "consumer") return "Personal durable agent";
  if (profile === "temporary_durable") return "Temporary durable run";
  if (profile === "workflow") return "Multi-step workflow";
  return "Instant request";
}

function memoryExplanation(profile: string) {
  if (profile === "consumer") return "Your approved context is sticky to your personal durable Agent actor.";
  if (profile === "temporary_durable") return "State lasts for this isolated durable run and is not reused here.";
  if (profile === "workflow") return "Cloudflare Workflow owns durable steps and retries; this screen does not create chat memory.";
  return "This request is isolated. It does not reuse conversational memory.";
}

function statusMessage(status: string, executionId: string) {
  if (status === "waiting_approval") return `A governed proposal is waiting in Work Inbox. Execution ${executionId.slice(0, 8)}.`;
  if (status === "queued") return `The durable workflow was queued. Execution ${executionId.slice(0, 8)}.`;
  if (status === "deferred") return `The process is paused, so this work was recorded for later review. Execution ${executionId.slice(0, 8)}.`;
  return `Run status: ${status}. Execution ${executionId.slice(0, 8)}.`;
}
