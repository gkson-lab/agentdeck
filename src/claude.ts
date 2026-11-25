/** Thin wrappers around the official `claude` CLI: sign-in, status, the agents on this machine, and cloud hand-off. */
import { execFile, spawn } from "node:child_process";
import { platform } from "node:os";
import { bus } from "./store.js";

export const CLAUDE_BIN = process.env.CLAUDE_BIN ?? "claude";

function run(args: string[], timeoutMs = 15000): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    execFile(CLAUDE_BIN, args, { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      const code = err ? ((err as NodeJS.ErrnoException & { code?: number | string }).code === "ENOENT" ? 127 : 1) : 0;
      resolve({ stdout: String(stdout), stderr: String(stderr), code });
    });
  });
}

export interface ClaudeAuth {
  installed: boolean;
  loggedIn: boolean;
  authMethod?: string;
  email?: string;
  orgName?: string;
  subscriptionType?: string;
  raw?: Record<string, unknown>;
}

export async function claudeAuthStatus(): Promise<ClaudeAuth> {
  const r = await run(["auth", "status", "--json"]);
  if (r.code === 127) return { installed: false, loggedIn: false };
  try {
    const j = JSON.parse(r.stdout) as Record<string, unknown>;
    return {
      installed: true,
      loggedIn: Boolean(j.loggedIn),
      authMethod: j.authMethod as string | undefined,
      email: (j.email ?? j.emailAddress) as string | undefined,
      orgName: (j.orgName ?? j.organizationName) as string | undefined,
      subscriptionType: j.subscriptionType as string | undefined,
      raw: j,
    };
  } catch {
    return { installed: true, loggedIn: false };
  }
}

let loginProc: ReturnType<typeof spawn> | undefined;

/**
 * Starts Claude Code's own sign-in (`claude auth login`), which opens claude.ai in your browser.
 * agentdeck never sees your password or token: the CLI stores the credential where it always does.
 */
export function startLogin(method: "claudeai" | "console") {
  if (loginProc && loginProc.exitCode === null) return { started: false, message: "A sign-in is already in progress." };
  loginProc = spawn(CLAUDE_BIN, ["auth", "login", method === "console" ? "--console" : "--claudeai"], {
    stdio: ["pipe", "pipe", "pipe"],
    env: process.env,
  });
  const forward = (b: Buffer) => {
    // Pass the CLI's output (the sign-in URL, prompts) to the UI, without terminal escape codes.
    const text = b.toString().replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");
    if (text.trim()) bus.emit("auth-log", text);
  };
  loginProc.stdout!.on("data", forward);
  loginProc.stderr!.on("data", forward);
  loginProc.on("error", (e) => bus.emit("auth-log", `Could not start claude: ${e.message}\n`));
  loginProc.on("close", (code) => bus.emit("auth-done", code));
  return { started: true };
}

/** Some sign-in flows ask you to paste a code from the browser; this hands it to the CLI's prompt. */
export function sendLoginCode(code: string) {
  if (!loginProc || loginProc.exitCode !== null) return false;
  loginProc.stdin!.write(code.trim() + "\n");
  return true;
}

export async function logout() {
  return run(["auth", "logout"]);
}

/** Every Claude Code session on this computer (interactive, background, and ones agentdeck started). */
export async function machineAgents() {
  const r = await run(["agents", "--json", "--all"], 20000);
  if (r.code === 127) return { installed: false, sessions: [] };
  try {
    return { installed: true, sessions: JSON.parse(r.stdout) as unknown[] };
  } catch {
    return { installed: true, sessions: [], error: r.stderr.trim() || "Could not read `claude agents --json`." };
  }
}

const shq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/**
 * A new Claude Code cloud session (claude.ai/code) can only be created from an interactive terminal,
 * so this opens one running `claude --cloud "<task>"`. Returns the command so the UI can show it too.
 */
export function openCloudInTerminal(task: string, cwd: string): { opened: boolean; command: string; message?: string } {
  const command = `cd ${shq(cwd)} && ${CLAUDE_BIN} --cloud ${shq(task)}`;
  const os = platform();
  try {
    if (os === "darwin") {
      const as = command.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      spawn("osascript", ["-e", `tell application "Terminal" to do script "${as}"`, "-e", 'tell application "Terminal" to activate'], {
        detached: true,
        stdio: "ignore",
      }).unref();
      return { opened: true, command };
    }
    if (os === "linux") {
      spawn("x-terminal-emulator", ["-e", "bash", "-lc", command + "; exec bash"], { detached: true, stdio: "ignore" })
        .on("error", () => {})
        .unref();
      return { opened: true, command, message: "If no terminal opened, run the command yourself." };
    }
    if (os === "win32") {
      spawn("cmd.exe", ["/c", "start", "cmd", "/k", `cd /d "${cwd}" && claude --cloud "${task.replace(/"/g, "'")}"`], {
        detached: true,
        stdio: "ignore",
      }).unref();
      return { opened: true, command };
    }
  } catch {
    /* fall through */
  }
  return { opened: false, command, message: "Couldn't open a terminal here. Run the command yourself." };
}
