import type { Plugin, ViteDevServer } from "vite"
import path from "node:path"
import fs from "node:fs"

export interface AgentReviewOptions {
  /**
   * The file name where feedback items are written.
   * Defaults to '.agent-feedback.json' at the project root.
   */
  feedbackFile?: string

  /**
   * The local API endpoint used by the browser toolbar.
   * Defaults to '/api/dev/feedback'.
   */
  endpoint?: string
}

/**
 * Vite plugin providing local HTTP endpoints for the Agent Review Toolbar.
 * Runs strictly in development mode (apply: 'serve').
 */
export function agentReviewPlugin(options: AgentReviewOptions = {}): Plugin {
  const feedbackFileName = options.feedbackFile || ".agent-feedback.json"
  const endpoint = options.endpoint || "/api/dev/feedback"

  return {
    name: "vite-plugin-agent-review",
    apply: "serve",
    configureServer(server: ViteDevServer) {
      server.middlewares.use(endpoint, (req: any, res: any) => {
        const feedbackFilePath = path.resolve(process.cwd(), feedbackFileName)

        // POST: Save feedback batch from browser toolbar
        if (req.method === "POST") {
          let body = ""
          req.on("data", (chunk: any) => {
            body += chunk
          })
          req.on("end", () => {
            try {
              const parsed = JSON.parse(body || "{}")
              fs.writeFileSync(
                feedbackFilePath,
                JSON.stringify(parsed, null, 2),
                "utf-8",
              )
              console.log(
                `[Agent Review API] Saved ${parsed.items?.length || 0} feedback items to ${feedbackFileName}`,
              )
              res.statusCode = 200
              res.setHeader("Content-Type", "application/json")
              res.end(
                JSON.stringify({
                  success: true,
                  count: parsed.items?.length || 0,
                  filePath: feedbackFileName,
                }),
              )
            } catch (err: any) {
              res.statusCode = 400
              res.setHeader("Content-Type", "application/json")
              res.end(JSON.stringify({ error: err.message }))
            }
          })
          return
        }

        // GET: Fetch currently stored feedback items
        if (req.method === "GET") {
          res.setHeader("Content-Type", "application/json")
          if (fs.existsSync(feedbackFilePath)) {
            res.statusCode = 200
            res.end(fs.readFileSync(feedbackFilePath, "utf-8"))
          } else {
            res.statusCode = 200
            res.end(JSON.stringify({ success: true, count: 0, items: [] }))
          }
          return
        }

        // DELETE: Clear stored feedback
        if (req.method === "DELETE") {
          res.setHeader("Content-Type", "application/json")
          if (fs.existsSync(feedbackFilePath)) {
            fs.unlinkSync(feedbackFilePath)
          }
          res.statusCode = 200
          res.end(
            JSON.stringify({ success: true, message: "Cleared feedback file" }),
          )
          return
        }

        res.statusCode = 405
        res.end()
      })
    },
  }
}

export default agentReviewPlugin
