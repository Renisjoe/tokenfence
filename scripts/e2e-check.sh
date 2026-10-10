#!/usr/bin/env bash
# End-to-end smoke check for TokenFence, using a throwaway fake provider.
#
#   bash scripts/e2e-check.sh
#
# Proves the whole path works outside the test suite: the CLI boots, the proxy
# forwards, spend is metered into the ledger, the budget blocks the next call,
# and `tokenfence report` reads that ledger back. No API key, no network.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$(mktemp -d)"
UPSTREAM_PORT=9911
PROXY_PORT=9912
ANTHROPIC_PROXY_PORT=9913
FAILURES=0

cleanup() {
  [[ -n "${PROXY_PID:-}" ]] && kill "$PROXY_PID" 2>/dev/null
  [[ -n "${ANTHROPIC_PID:-}" ]] && kill "$ANTHROPIC_PID" 2>/dev/null
  [[ -n "${UPSTREAM_PID:-}" ]] && kill "$UPSTREAM_PID" 2>/dev/null
  rm -rf "$WORK"
}
trap cleanup EXIT

check() { # check <label> <actual> <expected>
  if [[ "$2" == "$3" ]]; then
    echo "  ok   $1"
  else
    echo "  FAIL $1 — expected '$3', got '$2'"
    FAILURES=$((FAILURES + 1))
  fi
}

# --- a stand-in provider -------------------------------------------------------
# Answers in whichever dialect the path implies, so one process can stand in for
# both OpenAI and Anthropic.
node -e "
const http = require('node:http');
http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    res.writeHead(200, { 'content-type': 'application/json' });
    if (req.url.endsWith('/messages')) {
      res.end(JSON.stringify({
        id: 'msg-e2e', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5',
        content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn',
        usage: { input_tokens: 1000, output_tokens: 500, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      }));
      return;
    }
    res.end(JSON.stringify({
      id: 'chatcmpl-e2e', object: 'chat.completion', model: 'gpt-4o-mini',
      choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1000, completion_tokens: 500, total_tokens: 1500 },
    }));
  });
}).listen($UPSTREAM_PORT, '127.0.0.1');
" &
UPSTREAM_PID=$!

cat > "$WORK/tokenfence.config.json" <<JSON
{
  "listen": { "host": "127.0.0.1", "port": $PROXY_PORT },
  "upstream": { "baseUrl": "http://127.0.0.1:$UPSTREAM_PORT/v1", "apiKeyEnv": "TF_E2E_UPSTREAM_KEY" },
  "keys": [{ "name": "ci", "key": "tf_e2e_client", "dailyUsdBudget": 0.001 }],
  "models": { "gpt-4o-mini": { "inputPer1M": 1, "outputPer1M": 3 } },
  "usageFile": "tokenfence-usage.json"
}
JSON

# A second instance, same provider, speaking Anthropic's dialect instead.
cat > "$WORK/tokenfence.anthropic.config.json" <<JSON
{
  "listen": { "host": "127.0.0.1", "port": $ANTHROPIC_PROXY_PORT },
  "upstream": {
    "flavor": "anthropic",
    "baseUrl": "http://127.0.0.1:$UPSTREAM_PORT/v1",
    "apiKeyEnv": "TF_E2E_UPSTREAM_KEY"
  },
  "keys": [{ "name": "ci", "key": "tf_e2e_client", "dailyUsdBudget": 2 }],
  "models": { "claude-sonnet-5-5": { "inputPer1M": 1, "outputPer1M": 3 } },
  "usageFile": "tokenfence-usage-anthropic.json"
}
JSON

sleep 1
TF_E2E_UPSTREAM_KEY=sk-e2e-secret node "$ROOT/bin/tokenfence.mjs" serve --config "$WORK/tokenfence.config.json" > "$WORK/serve.log" 2>&1 &
PROXY_PID=$!
TF_E2E_UPSTREAM_KEY=sk-e2e-secret node "$ROOT/bin/tokenfence.mjs" serve --config "$WORK/tokenfence.anthropic.config.json" > "$WORK/serve-anthropic.log" 2>&1 &
ANTHROPIC_PID=$!
sleep 1.5

curl_() { curl -s -o "$WORK/body.json" -w '%{http_code}' "$@"; }

# Paths are passed as argv, not interpolated into the script, so the shell's
# path translation still applies on Windows.
read_json_code() {
  node -e "process.stdout.write(JSON.parse(require('node:fs').readFileSync(process.argv[1],'utf8')).error.code)" "$1" 2>/dev/null
}
read_json_count() {
  node -e "process.stdout.write(String(JSON.parse(require('node:fs').readFileSync(process.argv[1],'utf8')).entries.length))" "$1" 2>/dev/null
}

echo "1. health"
check "GET /healthz is 200" "$(curl_ "http://127.0.0.1:$PROXY_PORT/healthz")" "200"

echo "2. first call is forwarded and metered"
check "POST /v1/chat/completions is 200" \
  "$(curl_ -X POST "http://127.0.0.1:$PROXY_PORT/v1/chat/completions" \
      -H 'content-type: application/json' -H 'authorization: Bearer tf_e2e_client' \
      -H 'x-dump-headers: 1' -D "$WORK/headers.txt" \
      -d '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"hi"}]}')" "200"
check "cost header is 0.002500" "$(grep -i '^x-tokenfence-cost-usd' "$WORK/headers.txt" | tr -d '\r' | awk '{print $2}')" "0.002500"

echo "3. the same key is now over its 0.001 daily budget"
check "second call is 429" \
  "$(curl_ -X POST "http://127.0.0.1:$PROXY_PORT/v1/chat/completions" \
      -H 'content-type: application/json' -H 'authorization: Bearer tf_e2e_client' \
      -d '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"again"}]}')" "429"
check "error code is budget_exhausted" "$(read_json_code "$WORK/body.json")" "budget_exhausted"

echo "4. an unknown key is refused"
check "unknown key is 401" \
  "$(curl_ -X POST "http://127.0.0.1:$PROXY_PORT/v1/chat/completions" \
      -H 'content-type: application/json' -H 'authorization: Bearer nope' \
      -d '{"model":"gpt-4o-mini"}')" "401"

echo "5. the ledger on disk backs the report command"
check "ledger has one entry" "$(read_json_count "$WORK/tokenfence-usage.json")" "1"
node "$ROOT/bin/tokenfence.mjs" report --config "$WORK/tokenfence.config.json"

echo "6. the same guardrails over Anthropic's dialect"
check "POST /v1/messages is 200" \
  "$(curl_ -X POST "http://127.0.0.1:$ANTHROPIC_PROXY_PORT/v1/messages" \
      -H 'content-type: application/json' -H 'authorization: Bearer tf_e2e_client' \
      -D "$WORK/headers-anthropic.txt" \
      -d '{"model":"claude-sonnet-5-5","max_tokens":256,"messages":[{"role":"user","content":"hi"}]}')" "200"
check "cost header is 0.002500" \
  "$(grep -i '^x-tokenfence-cost-usd' "$WORK/headers-anthropic.txt" | tr -d '\r' | awk '{print $2}')" "0.002500"
check "the upstream saw /v1/messages" \
  "$(grep -c 'x-tokenfence-prompt-tokens' "$WORK/headers-anthropic.txt")" "1"
check "the other dialect's route is refused" \
  "$(curl_ -X POST "http://127.0.0.1:$ANTHROPIC_PROXY_PORT/v1/chat/completions" \
      -H 'content-type: application/json' -H 'authorization: Bearer tf_e2e_client' \
      -d '{"model":"claude-sonnet-5-5"}')" "404"
check "error code is wrong_dialect" "$(read_json_code "$WORK/body.json")" "wrong_dialect"

echo
if [[ $FAILURES -eq 0 ]]; then
  echo "e2e: all checks passed"
else
  echo "e2e: $FAILURES check(s) failed"
fi
exit $FAILURES
