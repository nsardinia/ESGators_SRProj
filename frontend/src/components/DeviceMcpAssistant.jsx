import { useEffect, useMemo, useState } from "react"
import { BACKEND_API_BASE_URL, getAuthHeaders } from "../lib/api"
import { useAuth } from "./AuthContext"
import Button from "./ui/button"
import { Card, CardContent } from "./ui/card"
import Textarea from "./ui/textarea"

const SUGGESTED_QUESTIONS = [
  "Summarize the latest readings for my devices and flag anything unusual.",
  "Which of my devices looks most concerning right now, and why?",
  "Compare the current readings for my selected device against the last 24 hours.",
]

function DeviceMcpAssistant({ nodes }) {
  const { user } = useAuth()
  const [status, setStatus] = useState({
    configured: false,
    loading: true,
    model: "",
    serverUrl: "",
    warning: "",
  })
  const [question, setQuestion] = useState("")
  const [selectedDeviceId, setSelectedDeviceId] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [conversation, setConversation] = useState([])

  const sortedNodes = useMemo(
    () => [...nodes].sort((left, right) => left.name.localeCompare(right.name)),
    [nodes]
  )

  useEffect(() => {
    let ignore = false

    const loadStatus = async () => {
      try {
        const response = await fetch(`${BACKEND_API_BASE_URL}/mcp/status`)
        const payload = await response.json().catch(() => ({}))

        if (!ignore) {
          setStatus({
            configured: Boolean(payload.configured),
            loading: false,
            model: payload.model || "",
            serverUrl: payload.serverUrl || "",
            warning: payload.warning || "",
          })
        }
      } catch (error) {
        if (!ignore) {
          setStatus({
            configured: false,
            loading: false,
            model: "",
            serverUrl: "",
            warning: error.message || "Failed to load MCP assistant status.",
          })
        }
      }
    }

    loadStatus()

    return () => {
      ignore = true
    }
  }, [])

  const handleAsk = async (nextQuestion = question) => {
    const trimmedQuestion = nextQuestion.trim()

    if (!trimmedQuestion || isSubmitting) {
      return
    }

    const pendingEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      question: trimmedQuestion,
      answer: "",
      error: "",
      selectedDeviceId,
    }

    setConversation((currentConversation) => [pendingEntry, ...currentConversation].slice(0, 8))
    setQuestion("")
    setIsSubmitting(true)

    try {
      const response = await fetch(`${BACKEND_API_BASE_URL}/mcp/ask`, {
        method: "POST",
        headers: await getAuthHeaders(user, {
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({
          question: trimmedQuestion,
          selectedDeviceId,
          deviceIds: sortedNodes.map((node) => node.id),
        }),
      })
      const payload = await response.json().catch(() => ({}))

      if (!response.ok) {
        throw new Error(payload.detail || payload.error || `HTTP ${response.status}`)
      }

      setConversation((currentConversation) =>
        currentConversation.map((entry) =>
          entry.id === pendingEntry.id
            ? {
                ...entry,
                answer: payload.answer || "The MCP assistant did not return any text.",
              }
            : entry
        )
      )
    } catch (error) {
      setConversation((currentConversation) =>
        currentConversation.map((entry) =>
          entry.id === pendingEntry.id
            ? {
                ...entry,
                error: error.message || "Failed to ask the MCP assistant.",
              }
            : entry
        )
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Card className="shadow-none">
      <CardContent className="flex flex-col gap-4 p-4">
        <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
          <p className="mb-1 text-[0.72rem] uppercase tracking-[0.08em] text-[#aebbd0]">Device Assistant</p>
          <div className="flex flex-wrap gap-2 text-[0.72rem] text-[#cbd5e1]">
            <span className={`inline-flex items-center rounded-full border px-2 py-1 ${status.configured ? "border-[rgba(62,207,142,0.45)] bg-[rgba(62,207,142,0.14)] text-[#bbf7d0]" : "border-[rgba(248,113,113,0.35)] bg-[rgba(248,113,113,0.1)] text-[#fecaca]"}`}>
              {status.loading ? "Checking MCP..." : status.configured ? "MCP Ready" : "Setup Needed"}
            </span>
            {status.model ? (
              <span className="inline-flex items-center rounded-full border border-[var(--border)] bg-[#182030] px-2 py-1">
                Model: {status.model}
              </span>
            ) : null}
          </div>
        </div>

        {status.warning ? (
          <div className="rounded-[12px] border border-[rgba(248,113,113,0.28)] bg-[rgba(127,29,29,0.16)] px-3 py-3 text-[0.82rem] leading-[1.45] text-[#fecaca]">
            {status.warning}
          </div>
        ) : null}

        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_220px]">
          <div className="flex flex-col gap-3">
            <Textarea
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder="Ask about anomalies, recent trends, which node needs attention, or what a reading might mean."
              className="min-h-32"
            />
            <div className="flex flex-wrap gap-2">
              {SUGGESTED_QUESTIONS.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  className="rounded-full border border-[var(--border)] bg-[#172132] px-3 py-1.5 text-left text-[0.76rem] leading-[1.35] text-[#d7e0ee] transition-colors hover:border-[#334055] hover:bg-[#1d283b]"
                  onClick={() => {
                    setQuestion(suggestion)
                    void handleAsk(suggestion)
                  }}
                  disabled={isSubmitting || !status.configured}
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-3 rounded-[12px] border border-[var(--border)] bg-[#101824] p-3">
            <label className="text-[0.72rem] font-bold uppercase tracking-[0.08em] text-[#aebbd0]" htmlFor="mcp-device-context">
              Device Context
            </label>
            <select
              id="mcp-device-context"
              value={selectedDeviceId}
              onChange={(event) => setSelectedDeviceId(event.target.value)}
              className="h-11 rounded-[10px] border border-[#2b3549] bg-[#0e131d] px-3 text-sm text-[var(--text)] outline-none transition-colors focus:border-[rgba(62,207,142,0.45)]"
            >
              <option value="">All my devices</option>
              {sortedNodes.map((node) => (
                <option key={node.id} value={node.id}>
                  {node.name} ({node.id})
                </option>
              ))}
            </select>
            <Button
              type="button"
              className="w-full"
              onClick={() => void handleAsk()}
              disabled={!question.trim() || isSubmitting || !status.configured}
            >
              {isSubmitting ? "Thinking..." : "Ask MCP Assistant"}
            </Button>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          {conversation.map((entry) => (
            <div
              key={entry.id}
              className="rounded-[14px] border border-[var(--border)] bg-[#0f1622] px-4 py-4"
            >
              <div className="mb-2 flex flex-wrap items-center gap-2 text-[0.72rem] text-[#aebbd0]">
                <span className="inline-flex items-center rounded-full border border-[rgba(125,211,252,0.24)] bg-[rgba(14,165,233,0.12)] px-2 py-1 text-[#bae6fd]">
                  You asked
                </span>
                {entry.selectedDeviceId ? (
                  <span className="inline-flex items-center rounded-full border border-[var(--border)] bg-[#182030] px-2 py-1">
                    Device: {entry.selectedDeviceId}
                  </span>
                ) : null}
              </div>
              <p className="m-0 whitespace-pre-wrap text-[0.92rem] leading-[1.55] text-[var(--text)]">
                {entry.question}
              </p>
              <div className="mt-4 rounded-[12px] border border-[rgba(62,207,142,0.18)] bg-[rgba(62,207,142,0.06)] px-4 py-3">
                {entry.error ? (
                  <p className="m-0 whitespace-pre-wrap text-[0.88rem] leading-[1.6] text-[#fecaca]">{entry.error}</p>
                ) : entry.answer ? (
                  <p className="m-0 whitespace-pre-wrap text-[0.88rem] leading-[1.6] text-[#d7f7e7]">{entry.answer}</p>
                ) : (
                  <p className="m-0 text-[0.84rem] leading-[1.5] text-[var(--muted)]">Waiting for tool-backed response...</p>
                )}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

export default DeviceMcpAssistant
