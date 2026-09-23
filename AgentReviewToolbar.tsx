import React, { useState, useEffect, useRef, useCallback } from "react"

export interface AgentReviewItem {
  id: string
  type: "copy_edit" | "design_note"
  page: string
  nearestHeading?: string
  selector?: string
  elementTag: string
  originalText?: string
  newText?: string
  note?: string
  timestamp: number
}

interface ActiveTarget {
  element: HTMLElement
  tag: string
  originalText: string
  currentText: string
  nearestHeading: string
  selector: string
  rect: DOMRect
  existingItemId?: string
}

export interface AgentReviewToolbarProps {
  currentView?: string
  endpoint?: string
  onNavigate?: (view: any) => void
}

const STORAGE_KEY = "agent_review_items"
const MODE_KEY = "agent_review_mode_active"

function isEditableTarget(target: HTMLElement | null): boolean {
  if (!target || target.closest("[data-agent-review-ignore='true']")) {
    return false
  }
  if (
    target === document.body ||
    target === document.documentElement ||
    target.id === "root"
  ) {
    return false
  }
  if (target.hasAttribute("data-agent-review-editable")) {
    return true
  }
  const text = target.innerText?.trim()
  if (!text) {
    return false
  }
  const standardTextTags = [
    "H1",
    "H2",
    "H3",
    "H4",
    "H5",
    "H6",
    "P",
    "SPAN",
    "BUTTON",
    "A",
    "LI",
    "BLOCKQUOTE",
    "LABEL",
    "CITE",
    "EM",
    "STRONG",
    "B",
    "I",
    "SMALL",
    "TIME",
    "FIGCAPTION",
    "CODE",
    "PRE",
  ]
  if (standardTextTags.includes(target.tagName)) {
    return true
  }
  // Badges, pill tags, or small containers
  if (["DIV", "SECTION", "ASIDE", "HEADER"].includes(target.tagName)) {
    if (target.childElementCount <= 2 && text.length > 0 && text.length < 350) {
      return true
    }
  }
  return false
}

export default function AgentReviewToolbar({
  currentView = "home",
  endpoint = "/api/dev/feedback",
}: AgentReviewToolbarProps) {
  // Guard: strictly dev-only
  if (!import.meta.env.DEV) {
    return null
  }

  const [isActive, setIsActive] = useState<boolean>(() => {
    try {
      return localStorage.getItem(MODE_KEY) === "true"
    } catch {
      return false
    }
  })

  const [items, setItems] = useState<AgentReviewItem[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      return saved ? JSON.parse(saved) : []
    } catch {
      return []
    }
  })

  const [isDrawerOpen, setIsDrawerOpen] = useState(false)
  const [hoveredRect, setHoveredRect] = useState<DOMRect | null>(null)
  const [hoveredTag, setHoveredTag] = useState<string>("")
  const [activeTarget, setActiveTarget] = useState<ActiveTarget | null>(null)
  const [editCopyValue, setEditCopyValue] = useState("")
  const [noteValue, setNoteValue] = useState("")
  const [activeTab, setActiveTab] = useState<"copy" | "note">("copy")
  const [submitStatus, setSubmitStatus] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const hoveredElementRef = useRef<HTMLElement | null>(null)
  const popoverRef = useRef<HTMLDivElement | null>(null)

  // Persist items to local storage
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(items))
    } catch (e) {
      console.error("Failed to save review items", e)
    }
  }, [items])

  // Persist mode toggle
  useEffect(() => {
    try {
      localStorage.setItem(MODE_KEY, String(isActive))
    } catch (e) {
      console.error("Failed to save review mode state", e)
    }
    if (isActive) {
      document.body.classList.add("agent-review-active")
    } else {
      document.body.classList.remove("agent-review-active")
      setHoveredRect(null)
      hoveredElementRef.current = null
      setActiveTarget(null)
    }
  }, [isActive])

  // Helper to find nearest heading
  const findNearestHeading = (el: HTMLElement): string => {
    let current: HTMLElement | null = el
    while (current && current !== document.body) {
      const heading = current.querySelector("h1, h2, h3, h4")
      if (heading && heading !== el) {
        return (heading as HTMLElement).innerText.trim().slice(0, 60)
      }
      if (current.previousElementSibling) {
        const prevHeading =
          current.previousElementSibling.querySelector("h1, h2, h3") ||
          (current.previousElementSibling.matches("h1, h2, h3")
            ? current.previousElementSibling
            : null)
        if (prevHeading) {
          return (prevHeading as HTMLElement).innerText.trim().slice(0, 60)
        }
      }
      current = current.parentElement
    }
    return ""
  }

  // Helper to generate a friendly CSS selector
  const generateSelector = (el: HTMLElement): string => {
    if (el.id) return `#${el.id}`
    const path: string[] = []
    let curr: HTMLElement | null = el
    while (curr && curr !== document.body && path.length < 3) {
      let segment = curr.tagName.toLowerCase()
      if (curr.id) {
        path.unshift(`#${curr.id}`)
        break
      }
      if (curr.getAttribute("data-section")) {
        path.unshift(`[data-section="${curr.getAttribute("data-section")}"]`)
        break
      }
      const parent = curr.parentElement
      if (parent) {
        const siblings = Array.from(parent.children).filter(
          (c) => c.tagName === curr!.tagName,
        )
        if (siblings.length > 1) {
          const index = siblings.indexOf(curr) + 1
          segment += `:nth-of-type(${index})`
        }
      }
      path.unshift(segment)
      curr = curr.parentElement
    }
    return path.join(" > ")
  }

  // Restore live edits into the DOM for the current page
  const reapplyEdits = useCallback(() => {
    const pageItems = items.filter(
      (i) => i.page === currentView && i.type === "copy_edit" && i.newText,
    )
    if (pageItems.length === 0) return

    pageItems.forEach((item) => {
      if (!item.originalText || !item.newText) return
      let target: HTMLElement | null = null
      if (item.selector) {
        try {
          target = document.querySelector(item.selector)
        } catch {
          target = null
        }
      }

      if (!target || target.innerText.trim() !== item.originalText) {
        const allCandidates = document.querySelectorAll<HTMLElement>(
          "h1, h2, h3, h4, h5, p, span, button, a, li, blockquote",
        )
        for (const el of allCandidates) {
          if (el.closest("[data-agent-review-ignore='true']")) continue
          if (el.innerText.trim() === item.originalText) {
            target = el
            break
          }
        }
      }

      const normalize = (s: string) => s.replace(/\s+/g, " ").trim()
      if (target) {
        if (normalize(target.innerText) === normalize(item.newText)) {
          target.removeAttribute("data-agent-review-modified")
        } else {
          target.setAttribute("data-agent-review-modified", "true")
          target.innerText = item.newText
        }
      }
    })
  }, [items, currentView])

  useEffect(() => {
    const timer = setTimeout(reapplyEdits, 250)
    return () => clearTimeout(timer)
  }, [reapplyEdits])

  // Mouse over / click handlers when in Review Mode
  useEffect(() => {
    if (!isActive) return

    const handleMouseOver = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (!isEditableTarget(target)) {
        return
      }

      hoveredElementRef.current = target
      const rect = target.getBoundingClientRect()
      setHoveredRect(rect)
      setHoveredTag(target.tagName.toLowerCase())
    }

    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (!isEditableTarget(target)) {
        return
      }

      e.preventDefault()
      e.stopPropagation()

      const text = target.innerText.trim()
      const heading = findNearestHeading(target)
      const selector = generateSelector(target)
      const rect = target.getBoundingClientRect()

      const existing = items.find(
        (i) =>
          i.page === currentView &&
          ((i.originalText && i.originalText === text) ||
            (i.newText && i.newText === text) ||
            (i.selector && i.selector === selector)),
      )

      setActiveTarget({
        element: target,
        tag: target.tagName.toLowerCase(),
        originalText: existing?.originalText || text,
        currentText: text,
        nearestHeading: heading,
        selector,
        rect,
        existingItemId: existing?.id,
      })

      setEditCopyValue(text)
      setNoteValue(existing?.note || "")
      setActiveTab(existing?.type === "design_note" ? "note" : "copy")
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.altKey && e.key.toLowerCase() === "e") {
        e.preventDefault()
        setIsActive((prev) => !prev)
      }
      if (e.key === "Escape") {
        setActiveTarget(null)
      }
    }

    window.addEventListener("mouseover", handleMouseOver)
    window.addEventListener("click", handleClick, true)
    window.addEventListener("keydown", handleKeyDown)

    return () => {
      window.removeEventListener("mouseover", handleMouseOver)
      window.removeEventListener("click", handleClick, true)
      window.removeEventListener("keydown", handleKeyDown)
    }
  }, [isActive, currentView, items])

  // Save current edit or note from the popover
  const handleSaveActiveTarget = () => {
    if (!activeTarget) return

    const isCopyEdit =
      activeTab === "copy" && editCopyValue.trim() !== activeTarget.originalText
    const isNote = activeTab === "note" && noteValue.trim().length > 0

    if (!isCopyEdit && !isNote) {
      setActiveTarget(null)
      return
    }

    const newItem: AgentReviewItem = {
      id:
        activeTarget.existingItemId ||
        `edit-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      type: isCopyEdit ? "copy_edit" : "design_note",
      page: currentView,
      nearestHeading: activeTarget.nearestHeading,
      selector: activeTarget.selector,
      elementTag: activeTarget.tag,
      originalText: activeTarget.originalText,
      newText: isCopyEdit ? editCopyValue.trim() : undefined,
      note: isNote ? noteValue.trim() : undefined,
      timestamp: Date.now(),
    }

    if (isCopyEdit) {
      activeTarget.element.innerText = editCopyValue.trim()
      activeTarget.element.setAttribute("data-agent-review-modified", "true")
    }

    setItems((prev) => {
      const filtered = prev.filter((i) => i.id !== newItem.id)
      return [...filtered, newItem]
    })

    setActiveTarget(null)
  }

  // Delete/revert single item
  const handleDeleteItem = (id: string) => {
    const item = items.find((i) => i.id === id)
    if (item && item.type === "copy_edit" && item.originalText) {
      try {
        if (item.selector) {
          const el = document.querySelector<HTMLElement>(item.selector)
          if (el) {
            el.innerText = item.originalText
            el.removeAttribute("data-agent-review-modified")
          }
        }
      } catch {
        // Fallback
      }
    }
    setItems((prev) => prev.filter((i) => i.id !== id))
  }

  // Clear all staged items
  const handleClearAll = () => {
    if (window.confirm("Are you sure you want to clear all staged feedback?")) {
      items.forEach((item) => {
        if (item.type === "copy_edit" && item.originalText && item.selector) {
          try {
            const el = document.querySelector<HTMLElement>(item.selector)
            if (el) {
              el.innerText = item.originalText
              el.removeAttribute("data-agent-review-modified")
            }
          } catch {
            // ignore
          }
        }
      })
      setItems([])
      try {
        localStorage.removeItem(STORAGE_KEY)
      } catch {
        // ignore
      }
    }
  }

  // Submit to dev middleware and copy to clipboard
  const handleSayGo = async () => {
    if (items.length === 0) return
    setIsSubmitting(true)
    setSubmitStatus(null)

    const payload = {
      timestamp: new Date().toISOString(),
      url: window.location.href,
      summary: {
        total: items.length,
        copyEdits: items.filter((i) => i.type === "copy_edit").length,
        designNotes: items.filter((i) => i.type === "design_note").length,
      },
      items,
    }

    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })

      if (res.ok) {
        setSubmitStatus(
          "Saved feedback! Tell your AI coding agent: 'Apply the staged review notes'.",
        )
      } else {
        setSubmitStatus(`Endpoint responded with status ${res.status}`)
      }
    } catch {
      setSubmitStatus("Failed to reach local endpoint. Saved to local storage.")
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div
      data-agent-review-ignore="true"
      className="fixed z-50 font-mono pointer-events-auto"
      style={{ zIndex: 99999 }}
    >
      {/* 1. Hover Overlay Box when Review Mode is active */}
      {isActive && hoveredRect && !activeTarget && (
        <div
          style={{
            position: "fixed",
            top: hoveredRect.top - 2,
            left: hoveredRect.left - 2,
            width: hoveredRect.width + 4,
            height: hoveredRect.height + 4,
            pointerEvents: "none",
            zIndex: 99998,
          }}
          className="border-2 border-dashed border-emerald-500 bg-emerald-500/10 transition-all duration-75 rounded-xs"
        >
          <span className="absolute -top-6 left-0 bg-neutral-900 border border-emerald-500 text-emerald-400 text-[10px] uppercase font-bold tracking-widest px-1.5 py-0.5 rounded-xs shadow-md">
            {hoveredTag} : click to edit
          </span>
        </div>
      )}

      {/* 2. Active Target Popover Editor */}
      {isActive && activeTarget && (
        <div
          ref={popoverRef}
          style={{
            position: "fixed",
            top: Math.max(
              12,
              Math.min(window.innerHeight - 340, activeTarget.rect.top),
            ),
            left: Math.max(
              12,
              Math.min(window.innerWidth - 440, activeTarget.rect.left),
            ),
            width: "420px",
            maxWidth: "calc(100vw - 24px)",
            zIndex: 99999,
          }}
          className="bg-neutral-900 border-2 border-emerald-500 shadow-2xl p-5 text-neutral-100 rounded-sm"
        >
          <div className="flex items-center justify-between pb-3 border-b border-neutral-700 mb-4">
            <div className="flex items-center gap-2 text-xs">
              <span className="px-1.5 py-0.5 bg-emerald-500 text-neutral-950 font-bold uppercase rounded-xs">
                {activeTarget.tag}
              </span>
              <span className="text-neutral-400 truncate max-w-[240px]">
                {activeTarget.nearestHeading || activeTarget.selector}
              </span>
            </div>
            <button
              onClick={() => setActiveTarget(null)}
              className="text-neutral-400 hover:text-neutral-100 text-sm cursor-pointer px-1"
            >
              ✕
            </button>
          </div>

          <div className="flex gap-2 mb-3">
            <button
              onClick={() => setActiveTab("copy")}
              className={`text-xs uppercase tracking-wider px-3 py-1.5 border transition-all cursor-pointer font-semibold ${
                activeTab === "copy"
                  ? "border-emerald-500 text-emerald-400 bg-emerald-500/10"
                  : "border-neutral-700 text-neutral-400 hover:text-neutral-100"
              }`}
            >
              Edit Copy
            </button>
            <button
              onClick={() => setActiveTab("note")}
              className={`text-xs uppercase tracking-wider px-3 py-1.5 border transition-all cursor-pointer font-semibold ${
                activeTab === "note"
                  ? "border-emerald-500 text-emerald-400 bg-emerald-500/10"
                  : "border-neutral-700 text-neutral-400 hover:text-neutral-100"
              }`}
            >
              Design Directive / Note
            </button>
          </div>

          {activeTab === "copy" ? (
            <div className="space-y-3">
              <div>
                <label className="text-[10px] uppercase text-neutral-400 block mb-1">
                  Original text:
                </label>
                <div className="text-xs text-neutral-400 bg-neutral-950 border border-neutral-800 p-2 max-h-20 overflow-y-auto italic">
                  "{activeTarget.originalText}"
                </div>
              </div>

              <div>
                <label className="text-[10px] uppercase text-emerald-400 font-bold block mb-1">
                  New draft copy:
                </label>
                <textarea
                  rows={4}
                  value={editCopyValue}
                  onChange={(e) => setEditCopyValue(e.target.value)}
                  onKeyDown={(e) => {
                    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                      handleSaveActiveTarget()
                    }
                  }}
                  autoFocus
                  className="w-full bg-neutral-950 border border-emerald-500/60 focus:border-emerald-500 text-neutral-100 p-2.5 text-xs font-mono focus:outline-none leading-relaxed"
                  placeholder="Enter revised text..."
                />
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <label className="text-[10px] uppercase text-emerald-400 font-bold block mb-1">
                  Design Directive / Instruction:
                </label>
                <textarea
                  rows={4}
                  value={noteValue}
                  onChange={(e) => setNoteValue(e.target.value)}
                  onKeyDown={(e) => {
                    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                      handleSaveActiveTarget()
                    }
                  }}
                  autoFocus
                  className="w-full bg-neutral-950 border border-emerald-500/60 focus:border-emerald-500 text-neutral-100 p-2.5 text-xs font-mono focus:outline-none leading-relaxed"
                  placeholder="e.g. 'Make this 3-column on desktop', 'Make text bolder', 'Change button to outline'..."
                />
              </div>
            </div>
          )}

          <div className="flex items-center justify-between pt-3 mt-3 border-t border-neutral-800">
            <span className="text-[10px] text-neutral-400">
              Press <kbd className="text-emerald-400">⌘+Enter</kbd> to save
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => setActiveTarget(null)}
                className="text-xs uppercase tracking-wider text-neutral-400 hover:text-neutral-100 px-3 py-1.5 cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveActiveTarget}
                className="text-xs uppercase tracking-wider bg-emerald-500 text-neutral-950 font-bold px-4 py-1.5 hover:brightness-110 cursor-pointer transition-all"
              >
                Apply Edit
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 3. Floating Bottom Toolbar Dock */}
      <div className="fixed bottom-4 right-4 flex items-center gap-2 z-50">
        <button
          onClick={() => setIsActive((prev) => !prev)}
          className={`flex items-center gap-2.5 px-3.5 py-2.5 rounded-full border shadow-xl backdrop-blur-md transition-all cursor-pointer text-xs font-mono ${
            isActive
              ? "bg-neutral-900 border-emerald-500 text-emerald-400"
              : "bg-neutral-950/90 border-neutral-700 text-neutral-400 hover:text-neutral-100"
          }`}
          title="Toggle inline review & editing mode (Alt + E)"
        >
          <span
            className={`w-2 h-2 rounded-full ${
              isActive ? "bg-emerald-400 animate-pulse" : "bg-neutral-500"
            }`}
          />
          <span className="font-semibold uppercase tracking-wider">
            {isActive ? "Review Mode: Active" : "Review Mode"}
          </span>
          <span className="text-[10px] opacity-60 ml-0.5">Alt+E</span>
        </button>

        <button
          onClick={() => setIsDrawerOpen((prev) => !prev)}
          className={`flex items-center gap-2 px-3.5 py-2.5 rounded-full border shadow-xl backdrop-blur-md transition-all cursor-pointer text-xs font-mono ${
            items.length > 0
              ? "bg-emerald-500 border-emerald-500 text-neutral-950 font-bold"
              : "bg-neutral-950/90 border-neutral-700 text-neutral-400 hover:text-neutral-100"
          }`}
        >
          <span>📋</span>
          <span>
            {items.length} {items.length === 1 ? "Edit" : "Edits"}
          </span>
          <span className="text-[11px]">{isDrawerOpen ? "▼" : "▲"}</span>
        </button>
      </div>

      {/* 4. Staged Changes Drawer */}
      {isDrawerOpen && (
        <div
          style={{
            position: "fixed",
            bottom: "70px",
            right: "16px",
            width: "480px",
            maxWidth: "calc(100vw - 32px)",
            maxHeight: "calc(100vh - 120px)",
            zIndex: 99999,
          }}
          className="bg-neutral-900 border border-emerald-500/40 shadow-2xl flex flex-col text-neutral-100 rounded-sm"
        >
          <div className="p-4 border-b border-neutral-800 flex items-center justify-between bg-neutral-950/60">
            <div>
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-500" />
                <h3 className="text-xs uppercase font-bold tracking-widest text-emerald-400">
                  Agent Review Drawer
                </h3>
              </div>
              <p className="text-[11px] text-neutral-400 mt-0.5">
                {items.length} items staged in local storage
              </p>
            </div>
            <button
              onClick={() => setIsDrawerOpen(false)}
              className="text-neutral-400 hover:text-neutral-100 text-sm cursor-pointer p-1"
            >
              ✕
            </button>
          </div>

          {submitStatus && (
            <div className="p-3 bg-emerald-500/15 border-b border-emerald-500/30 text-xs text-emerald-400 flex items-center justify-between gap-3 leading-relaxed">
              <span>{submitStatus}</span>
              <button
                onClick={handleClearAll}
                className="shrink-0 font-bold underline hover:text-neutral-100 cursor-pointer text-[10px] uppercase tracking-wider"
              >
                Clear Staged Draft
              </button>
            </div>
          )}

          <div className="p-4 overflow-y-auto space-y-3 flex-1 min-h-[160px] max-h-[380px]">
            {items.length === 0 ? (
              <div className="text-center py-10 text-neutral-400 space-y-2">
                <p className="text-sm">No feedback staged yet.</p>
                <p className="text-xs text-neutral-500 max-w-xs mx-auto">
                  Turn on Review Mode and click any text or card on the page to
                  start editing.
                </p>
              </div>
            ) : (
              items.map((item, idx) => (
                <div
                  key={item.id}
                  className="p-3 bg-neutral-950/80 border border-neutral-800 hover:border-emerald-500/40 transition-colors space-y-2 relative group"
                >
                  <div className="flex items-center justify-between text-[11px]">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-emerald-400 uppercase">
                        #{idx + 1} [{item.page}]
                      </span>
                      <span className="text-neutral-400 uppercase">
                        {item.type === "copy_edit" ? "Copy" : "Directive"} :
                        &lt;{item.elementTag}&gt;
                      </span>
                    </div>
                    <button
                      onClick={() => handleDeleteItem(item.id)}
                      className="text-neutral-400 hover:text-rose-400 cursor-pointer text-xs"
                      title="Discard this edit"
                    >
                      🗑️ Revert
                    </button>
                  </div>

                  {item.nearestHeading && (
                    <p className="text-[10px] text-neutral-500 italic">
                      Context: {item.nearestHeading}
                    </p>
                  )}

                  {item.type === "copy_edit" ? (
                    <div className="space-y-1 text-xs font-mono">
                      <div className="text-rose-400/80 line-through text-[11px] leading-relaxed">
                        - "{item.originalText}"
                      </div>
                      <div className="text-emerald-400 leading-relaxed">
                        + "{item.newText}"
                      </div>
                    </div>
                  ) : (
                    <div className="text-xs text-amber-300 italic bg-neutral-950 p-2 border-l-2 border-amber-400">
                      💬 "{item.note}"
                    </div>
                  )}
                </div>
              ))
            )}
          </div>

          <div className="p-4 border-t border-neutral-800 bg-neutral-950/80 flex items-center justify-between gap-3">
            <button
              onClick={handleClearAll}
              disabled={items.length === 0}
              className="text-xs uppercase tracking-wider text-neutral-400 hover:text-rose-400 disabled:opacity-30 disabled:hover:text-neutral-400 cursor-pointer transition-colors"
            >
              Clear All
            </button>

            <button
              onClick={handleSayGo}
              disabled={items.length === 0 || isSubmitting}
              className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider bg-emerald-500 text-neutral-950 px-5 py-2.5 hover:brightness-110 disabled:opacity-30 cursor-pointer transition-all shadow-lg"
            >
              <span>{isSubmitting ? "Saving..." : "🚀 Send to AI Agent"}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
