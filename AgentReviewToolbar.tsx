import React, { useState, useEffect, useRef, useCallback } from "react"

export interface EditorialItem {
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

interface EditorialToolbarProps {
  currentView: string
  onNavigate?: (view: any) => void
}

const STORAGE_KEY = "dm_editorial_items"
const MODE_KEY = "dm_editorial_mode_active"

function isEditableTarget(target: HTMLElement | null): boolean {
  if (!target || target.closest("[data-editorial-ignore='true']")) {
    return false
  }
  if (
    target === document.body ||
    target === document.documentElement ||
    target.id === "root"
  ) {
    return false
  }
  if (target.hasAttribute("data-editorial-editable")) {
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
  // Badges, pill tags, or small leaf containers (no children)
  if (["DIV", "SECTION", "ASIDE", "HEADER"].includes(target.tagName)) {
    if (
      target.childElementCount === 0 &&
      text.length > 0 &&
      text.length < 350
    ) {
      return true
    }
  }
  return false
}

export default function EditorialToolbar({
  currentView,
}: EditorialToolbarProps) {
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

  const [items, setItems] = useState<EditorialItem[]>(() => {
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
  const [isConfirmingClear, setIsConfirmingClear] = useState(false)
  const [popoverPos, setPopoverPos] = useState<{ top: number; left: number }>({
    top: 60,
    left: 40,
  })

  const hoveredElementRef = useRef<HTMLElement | null>(null)
  const popoverRef = useRef<HTMLDivElement | null>(null)

  // Measure and position popover reliably within viewport so buttons are never cut off
  useEffect(() => {
    if (!activeTarget) return

    const updatePosition = () => {
      const popoverEl = popoverRef.current
      const popWidth = popoverEl ? popoverEl.offsetWidth : 440
      const popHeight = popoverEl ? popoverEl.offsetHeight : 440
      const padding = 16

      const targetRect = activeTarget.element.getBoundingClientRect()

      // Horizontal positioning: align with target left, clamp within viewport
      let left = targetRect.left
      if (left + popWidth > window.innerWidth - padding) {
        left = window.innerWidth - popWidth - padding
      }
      if (left < padding) {
        left = padding
      }

      // Vertical positioning:
      // If placing at targetRect.top would push popover below viewport bottom:
      let top = targetRect.top
      if (top + popHeight > window.innerHeight - padding) {
        // Can we place it above target?
        if (targetRect.top - popHeight - 8 >= padding) {
          top = targetRect.top - popHeight - 8
        } else {
          // Clamp so that bottom of popover sits safely above viewport bottom
          top = Math.max(padding, window.innerHeight - popHeight - padding)
        }
      }
      if (top < padding) {
        top = padding
      }

      setPopoverPos({ top, left })
    }

    const timer = setTimeout(updatePosition, 10)
    window.addEventListener("resize", updatePosition)
    window.addEventListener("scroll", updatePosition, true)

    return () => {
      clearTimeout(timer)
      window.removeEventListener("resize", updatePosition)
      window.removeEventListener("scroll", updatePosition, true)
    }
  }, [activeTarget, editCopyValue, noteValue, activeTab])

  // Persist items
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(items))
    } catch (e) {
      console.error("Failed to save editorial items", e)
    }
  }, [items])

  // Persist mode toggle
  useEffect(() => {
    try {
      localStorage.setItem(MODE_KEY, String(isActive))
    } catch (e) {
      console.error("Failed to save editorial mode state", e)
    }
    if (isActive) {
      document.body.classList.add("editorial-mode-active")
    } else {
      document.body.classList.remove("editorial-mode-active")
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

  // Helper to generate an unambiguous CSS selector that uniquely resolves to this element
  const generateSelector = (el: HTMLElement): string => {
    if (el.id && el.id !== "root") return `#${el.id}`
    const path: string[] = []
    let curr: HTMLElement | null = el

    while (
      curr &&
      curr !== document.body &&
      curr !== document.documentElement
    ) {
      if (curr.id && curr.id !== "root") {
        path.unshift(`#${curr.id}`)
        break
      }
      if (curr.getAttribute("data-section")) {
        path.unshift(`[data-section="${curr.getAttribute("data-section")}"]`)
        break
      }

      let segment = curr.tagName.toLowerCase()
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

      // Test if current accumulated path uniquely resolves to this exact element
      try {
        const testSelector = path.join(" > ")
        const matches = document.querySelectorAll(testSelector)
        if (matches.length === 1 && matches[0] === el) {
          return testSelector
        }
      } catch {
        // ignore invalid syntax
      }

      curr = parent
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
      const normalize = (s: string) => s.replace(/\s+/g, " ").trim()

      // Try finding by selector first, but verify it matches original or new text
      let target: HTMLElement | null = null
      if (item.selector) {
        try {
          const candidate = document.querySelector<HTMLElement>(item.selector)
          if (
            candidate &&
            (normalize(candidate.innerText) === normalize(item.originalText) ||
              normalize(candidate.innerText) === normalize(item.newText))
          ) {
            target = candidate
          }
        } catch {
          target = null
        }
      }

      // If selector did not match (e.g. DOM indices shifted after deletions/insertions), scan by text
      if (!target) {
        const allCandidates = document.querySelectorAll<HTMLElement>(
          "h1, h2, h3, h4, h5, p, span, button, a, li, blockquote",
        )
        for (const el of allCandidates) {
          if (el.closest("[data-editorial-ignore='true']")) continue
          if (
            normalize(el.innerText) === normalize(item.originalText) ||
            normalize(el.innerText) === normalize(item.newText)
          ) {
            target = el
            break
          }
        }
      }

      if (target) {
        target.setAttribute("data-editorial-id", item.id)
        if (normalize(target.innerText) === normalize(item.newText)) {
          // Source code already matches this text, preserve React's rich formatting!
          target.removeAttribute("data-editorial-modified")
        } else {
          target.setAttribute("data-editorial-modified", "true")
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

      // Check if this exact element has already been edited (using DOM tag or exact element reference)
      const existingId = target.getAttribute("data-editorial-id")
      const existing = existingId
        ? items.find((i) => i.id === existingId)
        : items.find((i) => {
            if (i.page !== currentView) return false
            if (i.selector) {
              try {
                return document.querySelector(i.selector) === target
              } catch {
                return false
              }
            }
            return false
          })

      const normalize = (s: string) => s.replace(/\s+/g, " ").trim()
      const isAlreadyIntegrated =
        existing &&
        existing.type === "copy_edit" &&
        normalize(text) === normalize(existing.newText || "")

      setActiveTarget({
        element: target,
        tag: target.tagName.toLowerCase(),
        originalText: isAlreadyIntegrated
          ? text
          : existing?.originalText || text,
        currentText: text,
        nearestHeading: heading,
        selector,
        rect,
        existingItemId: isAlreadyIntegrated ? undefined : existing?.id,
      })

      setEditCopyValue(
        isAlreadyIntegrated ? text : existing?.newText || text,
      )
      setNoteValue(isAlreadyIntegrated ? "" : existing?.note || "")
      setActiveTab(
        existing?.type === "design_note" && !isAlreadyIntegrated
          ? "note"
          : "copy",
      )
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      // Toggle shortcut: Alt + E
      if (e.altKey && e.key.toLowerCase() === "e") {
        e.preventDefault()
        setIsActive((prev) => !prev)
      }
      // Escape closes popover
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

    const newItem: EditorialItem = {
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

    // Apply live change to DOM element and tag with ID
    if (isCopyEdit) {
      activeTarget.element.innerText = editCopyValue.trim()
      activeTarget.element.setAttribute("data-editorial-modified", "true")
    }
    activeTarget.element.setAttribute("data-editorial-id", newItem.id)

    setItems((prev) => {
      const filtered = prev.filter((i) => i.id !== newItem.id)
      return [...filtered, newItem]
    })

    setActiveTarget(null)
  }

  // Delete/revert single item
  const handleDeleteItem = (id: string) => {
    const item = items.find((i) => i.id === id)
    if (item) {
      try {
        const el =
          (item.selector
            ? document.querySelector<HTMLElement>(item.selector)
            : null) ||
          document.querySelector<HTMLElement>(`[data-editorial-id="${id}"]`)
        if (el) {
          if (item.type === "copy_edit" && item.originalText) {
            el.innerText = item.originalText
          }
          el.removeAttribute("data-editorial-modified")
          el.removeAttribute("data-editorial-id")
        }
      } catch {
        // Fallback
      }
    }
    setItems((prev) => prev.filter((i) => i.id !== id))
  }

  // Clear all staged items
  const handleClearAll = () => {
    items.forEach((item) => {
      try {
        const el =
          (item.selector
            ? document.querySelector<HTMLElement>(item.selector)
            : null) ||
          document.querySelector<HTMLElement>(
            `[data-editorial-id="${item.id}"]`,
          )
        if (el) {
          if (item.type === "copy_edit" && item.originalText) {
            el.innerText = item.originalText
          }
          el.removeAttribute("data-editorial-modified")
          el.removeAttribute("data-editorial-id")
        }
      } catch {
        // ignore
      }
    })
    setItems([])
    setIsConfirmingClear(false)
    try {
      localStorage.removeItem(STORAGE_KEY)
    } catch {
      // ignore
    }
  }

  // Generate markdown summary for clipboard
  const generateMarkdownSummary = (itemList: EditorialItem[]): string => {
    let md = `# Visual & Editorial Feedback Summary\n`
    md += `**Total Changes**: ${itemList.length} | **Generated**: ${new Date().toLocaleString("en-GB")}\n\n`

    const grouped: Record<string, EditorialItem[]> = {}
    itemList.forEach((item) => {
      grouped[item.page] = grouped[item.page] || []
      grouped[item.page].push(item)
    })

    for (const [page, pItems] of Object.entries(grouped)) {
      md += `## Page: ${page.toUpperCase()}\n\n`
      pItems.forEach((item, idx) => {
        const headingContext = item.nearestHeading
          ? ` (${item.nearestHeading})`
          : ""
        if (item.type === "copy_edit") {
          md += `### ${idx + 1}. Copy Edit: <${item.elementTag}>${headingContext}\n`
          if (item.selector) md += `*Selector*: \`${item.selector}\`\n`
          md += `**Original**:\n> "${item.originalText}"\n\n`
          md += `**Replacement**:\n> "${item.newText}"\n\n`
        } else {
          md += `### ${idx + 1}. Design Directive / Note: <${item.elementTag}>${headingContext}\n`
          if (item.selector) md += `*Selector*: \`${item.selector}\`\n`
          if (item.originalText)
            md += `*Element Context*: "${item.originalText.slice(0, 100)}..."\n`
          md += `**Note**:\n> ${item.note}\n\n`
        }
      })
    }

    md += `---\n*Prompt for Antigravity*: "I have saved visual edits in \`.dev-feedback.json\`. Please read the file and update the source code accordingly."\n`
    return md
  }

  // "Say Go" Action: submit to dev middleware and copy to clipboard
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
      // 1. Post to dev API middleware
      const res = await fetch("/api/dev/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })

      // 2. Copy markdown summary to clipboard as immediate convenience
      const markdown = generateMarkdownSummary(items)
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(markdown)
      }

      if (res.ok) {
        setSubmitStatus(
          "Saved to .dev-feedback.json & copied to clipboard! Just tell me 'apply the feedback' in chat.",
        )
      } else {
        setSubmitStatus(
          "Copied to clipboard! (Dev endpoint responded with " +
            res.status +
            ")",
        )
      }
    } catch {
      // Fallback: still copy to clipboard
      try {
        const markdown = generateMarkdownSummary(items)
        if (navigator.clipboard) {
          await navigator.clipboard.writeText(markdown)
        }
        setSubmitStatus(
          "Copied to clipboard! Switch to chat and paste or say 'apply feedback'.",
        )
      } catch {
        setSubmitStatus("Feedback captured in local storage.")
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div
      data-editorial-ignore="true"
      className="fixed z-9999 font-mono pointer-events-auto"
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
            zIndex: 9998,
          }}
          className="border-2 border-dashed border-[#52b788] bg-[#52b788]/5 transition-all duration-75 rounded-xs"
        >
          <span className="absolute -top-6 left-0 bg-[#0a1d17] border border-[#52b788] text-[#52b788] text-[10px] uppercase font-bold tracking-widest px-1.5 py-0.5 rounded-xs shadow-md">
            {hoveredTag} • click to edit
          </span>
        </div>
      )}

      {/* 2. Active Target Popover Editor */}
      {isActive && activeTarget && (
        <div
          ref={popoverRef}
          style={{
            position: "fixed",
            top: popoverPos.top,
            left: popoverPos.left,
            width: "440px",
            maxWidth: "calc(100vw - 24px)",
            maxHeight: "calc(100vh - 32px)",
            zIndex: 9999,
          }}
          className="bg-[#0a1d17] border-2 border-[#52b788] shadow-2xl p-5 text-[#f0ead6] rounded-xs animate-page-enter flex flex-col"
        >
          {/* Header */}
          <div className="flex items-center justify-between pb-3 border-b border-[#f0ead6]/10 mb-4 shrink-0">
            <div className="flex items-center gap-2 text-xs">
              <span className="px-1.5 py-0.5 bg-[#52b788] text-[#04100f] font-bold uppercase rounded-xs">
                {activeTarget.tag}
              </span>
              <span className="text-[#8a8070] truncate max-w-[240px]">
                {activeTarget.nearestHeading || activeTarget.selector}
              </span>
            </div>
            <button
              onClick={() => setActiveTarget(null)}
              className="text-[#8a8070] hover:text-[#f0ead6] text-sm cursor-pointer px-1"
            >
              ✕
            </button>
          </div>

          {/* Mode Tabs */}
          <div className="flex gap-2 mb-3 shrink-0">
            <button
              onClick={() => setActiveTab("copy")}
              className={`text-xs uppercase tracking-wider px-3 py-1.5 border transition-all cursor-pointer font-semibold ${
                activeTab === "copy"
                  ? "border-[#52b788] text-[#52b788] bg-[#52b788]/10"
                  : "border-[#f0ead6]/20 text-[#8a8070] hover:text-[#f0ead6]"
              }`}
            >
              Edit Copy
            </button>
            <button
              onClick={() => setActiveTab("note")}
              className={`text-xs uppercase tracking-wider px-3 py-1.5 border transition-all cursor-pointer font-semibold ${
                activeTab === "note"
                  ? "border-[#52b788] text-[#52b788] bg-[#52b788]/10"
                  : "border-[#f0ead6]/20 text-[#8a8070] hover:text-[#f0ead6]"
              }`}
            >
              Design Directive / Note
            </button>
          </div>

          {/* Content Area (Scrollable if needed, so action buttons stay visible) */}
          <div className="overflow-y-auto flex-1 pr-1 space-y-3 min-h-0">
            {activeTab === "copy" ? (
              <div className="space-y-3">
                <div>
                  <label className="text-[10px] uppercase text-[#8a8070] block mb-1">
                    Original text:
                  </label>
                  <div className="text-xs text-[#8a8070] bg-[#04100f] border border-[#f0ead6]/10 p-2 max-h-24 overflow-y-auto italic whitespace-pre-wrap leading-relaxed">
                    "{activeTarget.originalText}"
                  </div>
                </div>

                <div>
                  <label className="text-[10px] uppercase text-[#52b788] font-bold block mb-1">
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
                    className="w-full bg-[#04100f] border border-[#52b788]/60 focus:border-[#52b788] text-[#f0ead6] p-2.5 text-xs font-mono focus:outline-none leading-relaxed"
                    placeholder="Enter revised text..."
                  />
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div>
                  <label className="text-[10px] uppercase text-[#52b788] font-bold block mb-1">
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
                    className="w-full bg-[#04100f] border border-[#52b788]/60 focus:border-[#52b788] text-[#f0ead6] p-2.5 text-xs font-mono focus:outline-none leading-relaxed"
                    placeholder="e.g. 'Make this 3-column on desktop', 'Make text bolder', 'Change button to outline'..."
                  />
                </div>
              </div>
            )}
          </div>

          {/* Action buttons (Always visible at the bottom of popover) */}
          <div className="flex items-center justify-between pt-3 mt-3 border-t border-[#f0ead6]/10 shrink-0">
            <span className="text-[10px] text-[#8a8070]">
              Press <kbd className="text-[#52b788]">⌘+Enter</kbd> to save
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => setActiveTarget(null)}
                className="text-xs uppercase tracking-wider text-[#8a8070] hover:text-[#f0ead6] px-3 py-1.5 cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveActiveTarget}
                className="text-xs uppercase tracking-wider bg-[#52b788] text-[#04100f] font-bold px-4 py-1.5 hover:brightness-110 cursor-pointer transition-all shadow-md"
              >
                Apply Edit
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 3. Floating Bottom Toolbar Dock */}
      <div className="fixed bottom-4 right-4 flex items-center gap-2 z-9999">
        {/* Toggle Mode Button */}
        <button
          onClick={() => setIsActive((prev) => !prev)}
          className={`flex items-center gap-2.5 px-3.5 py-2.5 rounded-full border shadow-xl backdrop-blur-md transition-all cursor-pointer text-xs font-mono ${
            isActive
              ? "bg-[#0a1d17] border-[#52b788] text-[#52b788]"
              : "bg-[#04100f]/90 border-[#f0ead6]/20 text-[#8a8070] hover:text-[#f0ead6]"
          }`}
          title="Toggle inline review & editing mode (Alt + E)"
        >
          <span
            className={`w-2 h-2 rounded-full ${
              isActive ? "bg-[#52b788] animate-pulse" : "bg-[#8a8070]/60"
            }`}
          />
          <span className="font-semibold uppercase tracking-wider">
            {isActive ? "Review Mode: Active" : "Review Mode"}
          </span>
          <span className="text-[10px] opacity-60 ml-0.5">Alt+E</span>
        </button>

        {/* Staged Changes Counter & Drawer Opener */}
        <button
          onClick={() => setIsDrawerOpen((prev) => !prev)}
          className={`flex items-center gap-2 px-3.5 py-2.5 rounded-full border shadow-xl backdrop-blur-md transition-all cursor-pointer text-xs font-mono ${
            items.length > 0
              ? "bg-[#52b788] border-[#52b788] text-[#04100f] font-bold"
              : "bg-[#04100f]/90 border-[#f0ead6]/20 text-[#8a8070] hover:text-[#f0ead6]"
          }`}
        >
          <span>📋</span>
          <span>
            {items.length} {items.length === 1 ? "Edit" : "Edits"}
          </span>
          <span className="text-[11px]">{isDrawerOpen ? "▼" : "▲"}</span>
        </button>
      </div>

      {/* 4. Staged Changes Drawer / Panel */}
      {isDrawerOpen && (
        <div
          style={{
            position: "fixed",
            bottom: "70px",
            right: "16px",
            width: "480px",
            maxWidth: "calc(100vw - 32px)",
            maxHeight: "calc(100vh - 120px)",
            zIndex: 9999,
          }}
          className="bg-[#0a1d17] border border-[#52b788]/40 shadow-2xl flex flex-col text-[#f0ead6] rounded-xs animate-page-enter"
        >
          {/* Header */}
          <div className="p-4 border-b border-[#f0ead6]/10 flex items-center justify-between bg-[#04100f]/60">
            <div>
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-[#52b788]" />
                <h3 className="text-xs uppercase font-bold tracking-widest text-[#52b788]">
                  Editorial & Review Drawer
                </h3>
              </div>
              <p className="text-[11px] text-[#8a8070] mt-0.5">
                {items.length} items staged in local storage
              </p>
            </div>
            <button
              onClick={() => {
                setIsDrawerOpen(false)
                setIsConfirmingClear(false)
              }}
              className="text-[#8a8070] hover:text-[#f0ead6] text-sm cursor-pointer p-1"
            >
              ✕
            </button>
          </div>

          {/* Submission status toast */}
          {submitStatus && (
            <div className="p-3 bg-[#52b788]/15 border-b border-[#52b788]/30 text-xs text-[#52b788] flex items-center justify-between gap-3 leading-relaxed">
              <span>{submitStatus}</span>
              {isConfirmingClear ? (
                <div className="flex items-center gap-1.5 shrink-0 bg-[#e8421a]/20 border border-[#e8421a]/40 px-2 py-1 rounded-xs">
                  <span className="text-[10px] text-[#f0ead6] font-bold">Clear all?</span>
                  <button
                    onClick={handleClearAll}
                    className="text-[10px] font-bold uppercase bg-[#e8421a] text-[#04100f] px-1.5 py-0.5 rounded-xs hover:brightness-110 cursor-pointer"
                  >
                    Yes
                  </button>
                  <button
                    onClick={() => setIsConfirmingClear(false)}
                    className="text-[10px] text-[#8a8070] hover:text-[#f0ead6] cursor-pointer px-1"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setIsConfirmingClear(true)}
                  className="shrink-0 font-bold underline hover:text-[#f0ead6] cursor-pointer text-[10px] uppercase tracking-wider"
                >
                  Clear Staged Draft
                </button>
              )}
            </div>
          )}

          {/* Items List */}
          <div className="p-4 overflow-y-auto space-y-3 flex-1 min-h-[160px] max-h-[380px]">
            {items.length === 0 ? (
              <div className="text-center py-10 text-[#8a8070] space-y-2">
                <p className="text-sm">No feedback staged yet.</p>
                <p className="text-xs text-[#8a8070]/70 max-w-xs mx-auto">
                  Turn on Review Mode and click any text or card on the page to
                  start editing.
                </p>
              </div>
            ) : (
              items.map((item, idx) => (
                <div
                  key={item.id}
                  className="p-3 bg-[#04100f]/80 border border-[#f0ead6]/10 hover:border-[#52b788]/40 transition-colors space-y-2 relative group"
                >
                  <div className="flex items-center justify-between text-[11px]">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-[#52b788] uppercase">
                        #{idx + 1} [{item.page}]
                      </span>
                      <span className="text-[#8a8070] uppercase">
                        {item.type === "copy_edit" ? "Copy" : "Directive"} •
                        &lt;{item.elementTag}&gt;
                      </span>
                    </div>
                    <button
                      onClick={() => handleDeleteItem(item.id)}
                      className="text-[#8a8070] hover:text-[#e8421a] cursor-pointer text-xs"
                      title="Discard this edit"
                    >
                      🗑️ Revert
                    </button>
                  </div>

                  {item.nearestHeading && (
                    <p className="text-[10px] text-[#8a8070]/80 italic">
                      Context: {item.nearestHeading}
                    </p>
                  )}

                  {item.type === "copy_edit" ? (
                    <div className="space-y-1 text-xs font-mono">
                      <div className="text-[#e8421a]/80 line-through text-[11px] leading-relaxed">
                        - "{item.originalText}"
                      </div>
                      <div className="text-[#52b788] leading-relaxed">
                        + "{item.newText}"
                      </div>
                    </div>
                  ) : (
                    <div className="text-xs text-[#ffd4a0] italic bg-[#0a1d17] p-2 border-l-2 border-[#ffd4a0]">
                      💬 "{item.note}"
                    </div>
                  )}
                </div>
              ))
            )}
          </div>

          {/* Footer with Actions */}
          <div className="p-4 border-t border-[#f0ead6]/10 bg-[#04100f]/80 flex items-center justify-between gap-3">
            {isConfirmingClear ? (
              <div className="flex items-center gap-2 bg-[#e8421a]/15 border border-[#e8421a]/40 px-2.5 py-1.5 rounded-xs animate-page-enter">
                <span className="text-[11px] text-[#f0ead6] font-medium">
                  Clear all edits?
                </span>
                <button
                  onClick={handleClearAll}
                  className="text-[10px] font-bold uppercase tracking-wider bg-[#e8421a] text-[#04100f] px-2 py-1 hover:brightness-110 cursor-pointer rounded-xs transition-all shadow-xs"
                >
                  Confirm
                </button>
                <button
                  onClick={() => setIsConfirmingClear(false)}
                  className="text-[10px] uppercase tracking-wider text-[#8a8070] hover:text-[#f0ead6] px-1.5 py-1 cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => setIsConfirmingClear(true)}
                disabled={items.length === 0}
                className="text-xs uppercase tracking-wider text-[#8a8070] hover:text-[#e8421a] disabled:opacity-30 disabled:hover:text-[#8a8070] cursor-pointer transition-colors"
              >
                Clear All
              </button>
            )}

            <button
              onClick={handleSayGo}
              disabled={items.length === 0 || isSubmitting}
              className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider bg-[#52b788] text-[#04100f] px-5 py-2.5 hover:brightness-110 disabled:opacity-30 cursor-pointer transition-all shadow-lg shadow-[#52b788]/20"
            >
              <span>
                {isSubmitting ? "Saving..." : "🚀 Say Go: Save to AI"}
              </span>
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
