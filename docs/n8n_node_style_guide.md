# n8n Node Style Guide

Purpose: define one practical standard for authoring n8n Code nodes and HTTP Request nodes in this repo.

## 1) Scope and Required References

This guide covers:
- Code-node authoring style (inline and externalized)
- Code-node input/output expectations
- HTTP Request JSON body construction for PKM backend endpoints

Read together with:
- `docs/n8n_sync.md` (sync process and operational flow)
- `docs/api.md` (backend endpoint contracts)

## 2) Runtime Model: Code Node Inputs and Outputs

Available runtime variables (Code node):
- `$json`: current input item JSON
- `$input`: access to all input items (`$input.all()`)
- `$items`: legacy full input list (prefer `$input`)
- `$node`, `$env`, `helpers`

Return requirements:
- Must return an array.
- Each element should be an n8n item object, usually `{ json: ... }`.

Good:
```js
return [{ json: { ok: true } }];
```

Good:
```js
const rows = $input.all().map(i => i.json);
return rows.map(r => ({ json: r }));
```

## 3) Authoring Rules (Code Node)

### 3.1 Inline vs externalized
- `< 50` non-empty lines: inline in workflow JSON.
- `>= 50` non-empty lines: externalize to `src/n8n/nodes/...` and keep thin wrapper in workflow.

### 3.2 Keep inline code simple
- Do not use module wrapper patterns in inline code (`module.exports`, `exports.default`, `ctx` wrapper shims).
- Use n8n runtime variables directly.
- Return explicit n8n item arrays.

### 3.3 Externalized path rules
- Use absolute mounted paths under `/data/...`.
- Do not use fragile relative repo imports like `../../../src/...`.
- Example:
```js
const { getConfig } = require('/data/src/libs/config.js');
```

## 4) Telegram Node Rules

### 4.1 Trigger and entry-point policy
- Entry workflows must use Telegram sender user-id validation at the entry point only.
- Do not re-validate or fan out `telegram_user_id` into subworkflows.
- Trigger filters should be user-based (`userIds`) for access control, not chat-based (`chatIds`), unless a workflow is intentionally admin-chat-only.

### 4.2 Chat-id contract
- Canonical payload field is `telegram_chat_id`.
- Do not use `$json.chat_id` in n8n workflow expressions or Code-node outputs.
- When calling subworkflows, always pass `telegram_chat_id` in payload (`{ json: { ...$json, telegram_chat_id } }`).

### 4.3 Sender-node chat-id resolution order
Use this fallback order in Telegram sender nodes:
1. direct source-trigger node chat id (when trigger exists in same workflow)
2. current item message chat id (`$json.message.chat.id`)
3. propagated field (`$json.telegram_chat_id`)
4. admin fallback (`$env.TELEGRAM_ADMIN_CHAT_ID`)

Template:
```js
={{ (($node["Telegram Trigger"] && $node["Telegram Trigger"].json && $node["Telegram Trigger"].json.message && $node["Telegram Trigger"].json.message.chat && $node["Telegram Trigger"].json.message.chat.id)
  || ($json.message && $json.message.chat && $json.message.chat.id)
  || $json.telegram_chat_id
  || $env.TELEGRAM_ADMIN_CHAT_ID) }}
```

### 4.4 Parsing and escaping
- Telegram sends must use `parse_mode=MarkdownV2`.
- Any dynamic value in `telegram_message` must be escaped for MarkdownV2 before send.
- Keep escaping in one helper (`mdv2`) and reuse it in message-builder nodes.

### 4.5 Data-shape stability across HTTP/code nodes
- Some nodes replace `$json`; preserve `telegram_chat_id` explicitly when reshaping payloads.
- If a node rebuilds `json`, copy routing fields (`telegram_chat_id`, `telegram_message_id`) forward intentionally.

## 5) HTTP Request Node Rules (PKM Backend)

When sending JSON payloads (especially nested objects like `metadata`):

Node settings:
- `Send Body`: ON
- `Body Content Type`: JSON
- `Specify Body`: Using JSON

Body rule:
- Build one JS object in a single expression and return `JSON.stringify(...)`.
- Never place object expressions inside quoted JSON fields.

Template:
```js
{{ JSON.stringify((() => {
  const body = {
    id: $json.id ?? null,
    title: $json.title ?? null,
    url: $json.url ?? null,
  };

  const retrieval = $json.retrieval ?? null;
  body.metadata = retrieval ? { retrieval } : null;

  const score = $json.quality_score;
  body.quality_score = (score === '' || score == null) ? null : Number(score);

  const clean = String($json.clean_text ?? '').trim();
  if (clean) body.clean_text = clean;

  body.returning = ['id', 'entry_id', 'created_at'];
  return body;
})()) }}
```

## 6) Canonical Examples

### 6.1 Externalized code with thin wrapper
Workflow wrapper:
```js
try {
  const fn = require('/data/src/n8n/nodes/10-read/format-telegram-message__f305ac84-35d3-44df-8ef5-1c0e004f37b8.js');
  return await fn({ $input, $json, $items, $node, $env, helpers });
} catch (e) {
  e.message = `[extjs:10-read/format-telegram-message__f305ac84-35d3-44df-8ef5-1c0e004f37b8.js] ${e.message}`;
  throw e;
}
```

Externalized file:
```js
'use strict';

module.exports = async function run(ctx) {
  const { $json } = ctx;
  const item = { ...$json };
  delete item.title;
  delete item.author;
  return [{ json: item }];
};
```

### 6.2 Small inline parse node
```js
const text = String($json.text || '').trim();
const isCommand = text.startsWith('/');
return [{ json: { ...$json, isCommand } }];
```

### 6.3 MarkdownV2 Telegram message builder
```js
const mdv2 = (v) =>
  String(v ?? '').replace(/([_*\\[\\]()~`>#+\\-=|{}.!\\\\])/g, '\\\\$1');

const title = mdv2($json.title || 'Untitled');
const score = mdv2($json.score ?? 'n/a');
const telegram_message = `*Title:* ${title}\\n*Score:* ${score}`;

return [{ json: { ...$json, telegram_message } }];
```

## 7) Failure Modes and Fast Fixes

- `ctx is not defined`
  - Cause: inline code copied from module/externalized wrapper style.
  - Fix: remove `ctx` references; use `$json`, `$input`, etc.

- `Code doesn't return items properly`
  - Cause: returned plain objects instead of n8n items.
  - Fix: return `[{ json: ... }]`.

- `Cannot find module ...`
  - Cause: wrong path/import style.
  - Fix: use absolute `/data/...` paths and verify compose mount.

- `"[object Object]"` in HTTP payload
  - Cause: object embedded as quoted interpolation.
  - Fix: build object in expression and `JSON.stringify` whole body.

## Appendix A) Intended Document Structure

This guide is intentionally organized by execution flow, not by node type:

1. **Scope and references**: where this guide fits in the repo contract system.  
2. **Runtime model**: what n8n executes and expects.  
3. **Authoring rules**: enforceable standards for code shape and file placement.  
4. **Telegram rules**: trigger/auth/routing behavior and sender extraction order.  
5. **HTTP rules**: transport contract for backend calls from n8n.  
6. **Examples**: minimal patterns to copy safely.  
7. **Failure modes**: operational debugging shortcuts tied to real errors.

This structure is meant to avoid "template dumping" and keep one linear path:
what environment you are in -> what rules apply -> how to write nodes -> how to send API payloads -> how to debug.
