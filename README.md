# agentdeck

A local dashboard for your Claude agents. Sign in with your Claude account, start an agent on this computer or in the cloud, and watch every subagent it spawns work in **its own chamber**. Each chamber shows the agent's model and effort and has a box for talking to that agent directly.

A small pixel mascot does the work everywhere: it types while an agent runs, waves when one needs you, hops when it's done, and naps when nothing is going on.

## What it does

- **Sign in with Claude.** agentdeck uses Claude Code's own sign-in (`claude auth login`), which opens claude.ai in your browser. Your password and token never pass through agentdeck.
- **Agents on this computer.** Each task runs through the Claude Code CLI in the folder you pick, with the model, effort and permission mode you choose.
- **Agents in the cloud.**
  - *Cloud · Managed Agents* runs in an Anthropic-hosted sandbox (beta) and streams back into agentdeck. Subagents are session threads, so each one gets a chamber.
  - *Cloud · claude.ai/code* opens a terminal running `claude --cloud "<task>"`, which starts a Claude Code cloud session on your Claude account. (Claude Code only creates new cloud sessions from an interactive terminal.)
- **A chamber per subagent.** Each chamber has:
  - a status and an animated mascot
  - the model (◆) and the effort level (bars)
  - tool uses, tokens and timing
  - the agent's own live feed and its final report
  - a talk box
- **Talk to any agent.**
  - The main agent's chamber lets you pick a model and effort for your next message.
  - A message to a subagent is relayed by the main agent (Claude Code's `SendMessage`), and the subagent's reply shows up in its chamber.
- **Subagent roster.** Built-in subagents plus yours (`~/.claude/agents`) and the project's (`.claude/agents`), with their model and effort. You can start any of them as the main agent.
- **This computer.** Every Claude Code session running on the machine, from `claude agents --json`.

## Run it

Needs Node 20+ and [Claude Code](https://code.claude.com) (`claude` on your PATH).

```bash
git clone <this repo> agentdeck
cd agentdeck
npm install
npm start
```

Open <http://localhost:4477>. Set `PORT` to use another port.

### Cloud · Managed Agents setup (optional)

Managed Agents is billed to an Anthropic Console organization, separately from a claude.ai plan. Either sign in once with the Anthropic CLI (`ant auth login`) or set `ANTHROPIC_API_KEY` before `npm start`. On first use, agentdeck creates one environment and one agent per model + effort choice and reuses them afterwards (ids are saved in `~/.agentdeck/managed.json`). Sessions are billed for tokens and runtime and are kept until you delete them in the Console. The agents' web tools are off; turn them on in `src/managed.ts` if your tasks need the web.

## How it works

```
browser ──HTTP/SSE──▶ agentdeck server (127.0.0.1 only)
                        ├─ claude -p --output-format stream-json   (local agents)
                        ├─ claude auth / agents / --cloud          (sign-in, machine view, claude.ai hand-off)
                        └─ @anthropic-ai/sdk  beta.sessions         (Managed Agents)
```

- Every local turn is one `claude -p --output-format stream-json --verbose` process, and later turns use `--resume <session>`. That is why each message can use its own model and effort.
- Subagents come from the stream:
  - `Agent`/`Task` tool calls create the chambers.
  - `task_started`, `task_progress` and `task_notification` events drive status, tokens and reports.
  - Messages carrying `parent_tool_use_id` land in the right chamber.
- Runs are saved in `~/.agentdeck/runs.json`, so after a restart you can keep talking to earlier sessions.
- The server listens on 127.0.0.1 only and rejects requests from other origins or hosts, because it can start agents on your computer.

## The mascot

`public/mascot.js` holds the sprite as a 12×8 grid, read pixel by pixel from the reference image: flat orange (`#D77655`), black eyes, transparent everywhere else. It is drawn as SVG rects with `shape-rendering: crispEdges` at whole-pixel scales, so it never blurs. The animation frames change only a few pixels of the base sprite.

## Scripts

| Command | What it does |
|---|---|
| `npm start` | Start the server |
| `npm run dev` | Start with auto-reload |
| `npm run typecheck` | Type-check the server |
