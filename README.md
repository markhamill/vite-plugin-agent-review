# vite-plugin-agent-review

> **In-browser visual review and editorial harness for AI coding agents.**  
> Point, click, edit copy, leave design notes, and let your AI agent update the source code.

Designed for teams pair-programming with AI coding agents (**Antigravity**, **Claude Code**, **Cursor**, **Aider**, **Codex**).

---

## 💡 The Problem

When working with an AI coding agent on a web application, fine-tuning copy or giving layout feedback usually forces you into two bad options:
1. **Digging into JSX files** to edit strings manually (intimidating for non-developers, easy to break tags).
2. **Typing ambiguous chat prompts** (*"On the about page, 3rd card down, 2nd sentence, change X to Y"*), causing the agent to guess DOM nodes, edit the wrong lines, or flatten nested formatting.

## 🚀 The Solution

`vite-plugin-agent-review` turns your live browser window into an interactive review canvas:
1. **Toggle Review Mode** (`Alt + E` or bottom dock button).
2. **Click any element** (headings, paragraphs, badges, buttons, cards).
3. **Edit copy live** (previews in-situ in the DOM) or leave a **Design Directive** note.
4. **Click "Send to AI Agent"** &rarr; writes structured `.agent-feedback.json` to your project root.
5. **Tell your agent**: *"Apply the review notes in `.agent-feedback.json`."* The agent uses precise CSS selectors, nearest heading context, and diff strings to update your source files with 100% accuracy.
6. **Zero production footprint**: The plugin runs only during `vite dev` (`apply: 'serve'`). In production builds, the compiler tree-shakes and removes every byte of review tooling.

---

## 📦 Quickstart (The 2-File Drop)

Copy the two files from this repository into your Vite + React project:

```
your-project/
├── src/
│   └── components/
│       └── AgentReviewToolbar.tsx
├── vite-plugin-agent-review.ts
└── vite.config.ts
```

### 1. Register the plugin in `vite.config.ts`

```ts
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import { agentReviewPlugin } from "./vite-plugin-agent-review"

export default defineConfig({
  plugins: [
    react(),
    agentReviewPlugin() // creates dev endpoint: POST /api/dev/feedback
  ]
})
```

### 2. Mount the toolbar in your root component (`src/App.tsx`)

Gate the component behind `import.meta.env.DEV` so it compiles away to zero bytes in production:

```tsx
import { lazy, Suspense } from "react"

const AgentReviewToolbar = import.meta.env.DEV
  ? lazy(() => import("./components/AgentReviewToolbar"))
  : () => null

export default function App() {
  return (
    <div>
      {/* Your application code */}

      {/* Agent Review Toolbar (Dev Only) */}
      {import.meta.env.DEV && (
        <Suspense fallback={null}>
          <AgentReviewToolbar />
        </Suspense>
      )}
    </div>
  )
}
```

### 3. Add feedback storage to `.gitignore`

```gitignore
.agent-feedback.json
```

---

## 🛡️ Production Safety: Zero Bytes in Production

This setup uses a triple-layer safety mechanism to ensure the tool never leaks into production or impacts bundle size:

1. **Vite Plugin Gating (`apply: 'serve'`)**:  
   The server middleware is strictly limited to local development (`vite dev`). It does not run in `vite preview` or production builds.
2. **Dead-Code Elimination (`import.meta.env.DEV`)**:  
   In production builds, Vite statically replaces `import.meta.env.DEV` with `false`. The bundler detects the dead ternary branch (`false ? lazy(...) : () => null`) and completely tree-shakes the component, its styles, and its dependencies out of the output bundle.
3. **Component Runtime Guard**:  
   As defence-in-depth, `AgentReviewToolbar.tsx` includes an immediate check:
   ```ts
   if (!import.meta.env.DEV) return null
   ```

### How to verify it:
After running your production build (`npm run build` or `vite build`), you can inspect the `dist/` folder:
```bash
grep -rn "Review Mode" dist/
# Returns 0 results
```
Zero kilobytes of review code, listeners, or UI assets will ever ship to your live visitors.

---

## 🤖 Prompting Your AI Agent

Once you have staged changes in the browser drawer and clicked **"Send to AI Agent"**, switch to your agent chat and say:

> *"I have saved UI edits and design notes in `.agent-feedback.json`. Please read the file, locate the corresponding source files, and update the code accordingly."*

### The Generated Schema (`.agent-feedback.json`)

```json
{
  "timestamp": "2026-09-23T20:45:00.000Z",
  "url": "http://localhost:5173/about",
  "summary": {
    "total": 2,
    "copyEdits": 1,
    "designNotes": 1
  },
  "items": [
    {
      "id": "edit-1790200164215-shvt4",
      "type": "copy_edit",
      "page": "about",
      "nearestHeading": "Founder Profile",
      "selector": "div:nth-of-type(1) > div:nth-of-type(1) > h1",
      "elementTag": "h1",
      "originalText": "22 years in tech. Survived 3 startups.",
      "newText": "22 years in product. Survived 3 startups.",
      "timestamp": 1790200164215
    },
    {
      "id": "edit-1790200192615-lj5vr",
      "type": "design_note",
      "page": "about",
      "nearestHeading": "Career Credentials",
      "selector": "div:nth-of-type(2) > div > span:nth-of-type(1)",
      "elementTag": "span",
      "originalText": "Seed to Series A",
      "note": "Make this badge text bolder and check mobile wrap.",
      "timestamp": 1790200192615
    }
  ]
}
```

---

## ⚙️ Options

You can customise the feedback file path and endpoint in `vite.config.ts`:

```ts
agentReviewPlugin({
  feedbackFile: ".agent-feedback.json", // custom output file
  endpoint: "/api/dev/feedback"          // custom local API route
})
```

---

## 🌐 Adapting to Other Stacks (Next.js, Astro, Webpack)

While this repository packages a Vite plugin by default, the underlying architecture is completely stack-agnostic. 

- **The Client**: `AgentReviewToolbar.tsx` relies entirely on native browser DOM APIs (`getBoundingClientRect`, `innerText`, `fetch`). It has zero bundler-specific lock-in.
- **The Server**: The plugin is simply a lightweight local endpoint that writes incoming JSON to `.agent-feedback.json` on disk.

Here is how you can use this exact pattern in other environments:

### 1. Astro, SvelteKit, and Nuxt
Because these frameworks build on Vite, the included `agentReviewPlugin()` works out of the box in `astro.config.mjs`, `svelte.config.js`, or `nuxt.config.ts`.

### 2. Next.js (App Router)
Instead of a Vite plugin, create a development route handler at `app/api/dev/feedback/route.ts`:

```ts
import fs from "node:fs"
import path from "node:path"

export async function POST(req: Request) {
  // Guard: run strictly in development
  if (process.env.NODE_ENV !== "development") {
    return new Response(null, { status: 404 })
  }

  const body = await req.json()
  const feedbackFilePath = path.resolve(process.cwd(), ".agent-feedback.json")
  fs.writeFileSync(feedbackFilePath, JSON.stringify(body, null, 2), "utf-8")

  return Response.json({ success: true, count: body.items?.length || 0 })
}
```

In `app/layout.tsx`, mount the toolbar conditionally:
```tsx
{process.env.NODE_ENV === "development" && <AgentReviewToolbar />}
```

### 3. Webpack Dev Server
Webpack Dev Server uses the exact same Connect middleware interface. Add the route in your `webpack.config.js`:

```js
devServer: {
  setupMiddlewares: (middlewares, devServer) => {
    devServer.app.use("/api/dev/feedback", require("express").json(), (req, res) => {
      fs.writeFileSync(".agent-feedback.json", JSON.stringify(req.body, null, 2));
      res.json({ success: true });
    });
    return middlewares;
  }
}
```

### 4. Non-Node Backends (FastAPI, Django, Rails)
Simply create a local development endpoint (`POST /api/dev/feedback`) in your backend framework that receives the JSON payload and writes it directly to `.agent-feedback.json` at your repository root.

---

## 🎯 Element Targeting and Viewport Ergonomics

In complex web applications with repeated structures (such as comparison tables, pricing grids, and card matrices), simple selector generation and rigid popover placement can cause subtle bugs. `vite-plugin-agent-review` includes dedicated safeguards:

1. **Unambiguous Ancestor Traversal**:
   When generating CSS selectors, the generator climbs the DOM hierarchy and dynamically validates candidate paths against `document.querySelectorAll`. It resolves ancestor tags and nth-of-type indices until the selector uniquely resolves to exactly one element. Edits inside table cells or repeated rows will never collide or overwrite one another.

2. **Leaf Container Targeting**:
   Clicks strictly target leaf text nodes (`childElementCount === 0`) rather than parent layout containers or row wrappers. This ensures edits attach to the exact copy being revised.

3. **DOM Identity Tracking**:
   Edits are assigned unique review IDs stamped directly onto the DOM (`data-agent-review-id`). Live in-situ text changes remain tied to their originating elements even across local state re-renders.

4. **Viewport-Aware Popover Clamping and Pinned Actions**:
   The editing popover dynamically computes available viewport space. If an element sits near the bottom edge of the screen, the popover flips above the element. The popover uses a vertical flex layout with a scrollable text area and pinned action buttons (`Apply Edit` and `Cancel`), ensuring save controls are never pushed below the fold.

---

## 🛠️ Repository Maintenance and Committing Updates

To commit and push your updates to your GitHub repository:

```bash
# 1. Inspect status and diff
git status
git diff

# 2. Stage updated files
git add AgentReviewToolbar.tsx README.md

# 3. Commit changes
git commit -m "Fix selector collisions in tables and improve popover viewport clamping"

# 4. Push to GitHub
git push origin main
```

---

## 📄 License

MIT © [Mark Hamill](https://github.com/markhamill)
