import { Sandbox } from "@insforge/instabox-sdk";

const DEFAULT_MACHINE_IDENTIFIERS = [
  "koasis-alpha",
  "koasis-beta",
  "koasis-delta",
  "koasis-sigma",
  "koasis-omega",
];

const apiKey = (process.env.INSTABOX_API_KEY || "").trim();
const apiUrl = (process.env.INSTABOX_API_URL || "https://api.instabox.sh").trim().replace(/\/+$/, "");
const machineIdentifiers = (process.env.INSTABOX_SHARED_MACHINE_IDS || DEFAULT_MACHINE_IDENTIFIERS.join(","))
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

if (!apiKey) {
  console.error("INSTABOX_API_KEY belum dikonfigurasi; keep-alive dibatalkan.");
  process.exitCode = 1;
} else if (!machineIdentifiers.length) {
  console.error("INSTABOX_SHARED_MACHINE_IDS belum berisi machine yang akan dijaga aktif.");
  process.exitCode = 1;
} else {
  const connection = {
    apiKey,
    apiUrl,
    requestTimeoutMs: 30_000,
    operationTimeoutMs: 10 * 60_000,
  };

  const safeError = (error) => {
    const candidate = error && typeof error === "object" ? error : {};
    const code = typeof candidate.code === "string" ? candidate.code : "unknown";
    const message = typeof candidate.message === "string" ? candidate.message : "request failed";
    return `${code}: ${message.replaceAll(apiKey, "[redacted]").slice(0, 240)}`;
  };

  try {
    const machines = await Sandbox.list(connection);
    const results = [];

    for (const identifier of machineIdentifiers) {
      const machine = machines.find((candidate) => candidate.sandboxId === identifier || candidate.name === identifier);
      if (!machine) {
        results.push({ machine: identifier, status: "missing" });
        continue;
      }

      try {
        // Connecting with the default resume behavior wakes a machine that
        // crossed Instabox's idle-pause boundary. A no-op command then counts
        // as real activity and resets the idle timer without touching files.
        const sandbox = await Sandbox.connect(machine.sandboxId, connection);
        await sandbox.commands.run("true", { timeoutMs: 30_000 });
        const info = await sandbox.getInfo();
        results.push({
          machine: machine.name,
          status: "ok",
          state: info.state,
          autoSuspendMs: info.autoSuspendMs ?? null,
        });
      } catch (error) {
        results.push({ machine: machine.name, status: "error", error: safeError(error) });
      }
    }

    for (const result of results) console.log(JSON.stringify(result));
    if (results.some((result) => result.status !== "ok")) process.exitCode = 1;
  } catch (error) {
    console.error(`Instabox keep-alive gagal: ${safeError(error)}`);
    process.exitCode = 1;
  }
}
