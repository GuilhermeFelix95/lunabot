import process from "node:process";
import { setInterval } from "node:timers";

// CLI falso para os testes do ClaudeCliProvider. Imita a saída do `claude` real.
// O cenário é escolhido pela variável FAKE_CLAUDE_SCENARIO.

const SESSION_ID = "123e4567-e89b-42d3-a456-426614174000";
const scenario = process.env.FAKE_CLAUDE_SCENARIO ?? "happy";
const args = process.argv.slice(2);

function write(value) {
  const line = typeof value === "string" ? value : JSON.stringify(value);
  process.stdout.write(`${line}\n`);
}

function readStdin() {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });
}

function init() {
  return { type: "system", subtype: "init", session_id: SESSION_ID, tools: [] };
}

function textDelta(text) {
  return {
    type: "stream_event",
    event: {
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text },
    },
    session_id: SESSION_ID,
  };
}

function result(fields) {
  return {
    type: "result",
    subtype: "success",
    is_error: false,
    result: "ok",
    session_id: SESSION_ID,
    ...fields,
  };
}

if (args[0] === "auth") {
  const loggedIn = scenario !== "logged-out";
  write({ loggedIn, authMethod: loggedIn ? "claude.ai" : "none" });
  process.exitCode = loggedIn ? 0 : 1;
} else {
  const prompt = await readStdin();
  switch (scenario) {
    case "happy":
      write(init());
      write(textDelta("o"));
      write(textDelta("k"));
      write(result({}));
      break;
    case "echo-args":
      write(init());
      write(textDelta(JSON.stringify({ args, prompt })));
      write(result({}));
      break;
    case "auth-error":
      write(init());
      write(
        result({
          is_error: true,
          result: "Not logged in · Please run /login",
          api_error_status: null,
        }),
      );
      process.exitCode = 1;
      break;
    case "api-auth-status":
      write(init());
      write(result({ is_error: true, result: "Erro", api_error_status: 401 }));
      break;
    case "invalid-line":
      write(init());
      write("isto não é JSON");
      break;
    case "exit-code":
      process.stderr.write("falha simulada\n");
      process.exitCode = 3;
      break;
    case "no-result":
      write(init());
      write(textDelta("parcial"));
      break;
    case "hang":
      write(init());
      write(textDelta("parcial"));
      setInterval(() => {}, 1000);
      break;
    case "hang-pid":
      // Envia o próprio pid como delta, para o teste conferir se o processo morreu.
      write(init());
      write(textDelta(String(process.pid)));
      setInterval(() => {}, 1000);
      break;
    default:
      process.stderr.write(`cenário desconhecido: ${scenario}\n`);
      process.exitCode = 2;
  }
}
