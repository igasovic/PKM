# n8n HTTP Request Node Template (PKM Backend)

## Goal
Send **valid JSON** from n8n to the PKM backend (including **nested objects** like `metadata`) without n8n turning objects into `"[object Object]"`.

This template works for:
- `/db/insert`
- `/db/update`
- other PKM API endpoints that accept nested JSON / jsonb

---

## Required node settings
In **HTTP Request** node:

- **Method:** `POST` (or as required)
- **URL:** `http://pkm-server:8080/<endpoint>`
- **Send Body:** ✅ ON
- **Body Content Type:** `JSON`
- **Specify Body:** `Using JSON`

### Important rule
Use **one expression** for the entire body that returns a **string** via `JSON.stringify(...)`.

This guarantees:
- valid JSON
- correct escaping
- nested objects stay nested

---

## Body template (copy/paste)
Paste this into the **JSON** body field:

```js
{{ JSON.stringify((() => {
  // 1) Start with required parameters for the endpoint
  const body = {
    // example:
    // id: $json.id,
    // source: "telegram",
  };

  // 2) Add scalar fields (use nulls, not "NULL")
  body.title = $json.title ?? null;
  body.url = $json.url ?? null;

  // 3) Add nested JSON safely (object or null)
  // IMPORTANT: never wrap this in quotes
  const retrieval = $json.retrieval ?? null;
  body.metadata = retrieval ? { retrieval } : null;

  // 4) Optional: type fixes (numbers/booleans)
  // Only do this if upstream provides strings.
  const n = $json.score;
  body.quality_score = (n === null || n === undefined || n === "") ? null : Number(n);

  const b = $json.low_signal;
  body.low_signal = (b === null || b === undefined || b === "") ? null : (String(b) === "true");

  // 5) Optional: omit empty text fields (don’t overwrite with empty strings)
  const clean = String($json.clean_text ?? "").trim();
  if (clean) body.clean_text = clean;

  // 6) Optional: returning columns (db endpoints)
  body.returning = [
    "entry_id",
    "id",
    "created_at"
  ];

  return body;
})()) }}
```

---

## Common pitfalls (and the fix)

### Pitfall 1 — embedding expressions inside quoted JSON
Bad:
```json
"metadata": "{{$json.metadata_patch}}"
```
If `metadata_patch` is an object, it becomes:
```json
"metadata": "[object Object]"
```

Fix: use `JSON.stringify` for the whole body and assign objects normally (no quotes).

---

### Pitfall 2 — n8n “valid JSON” errors
If you see:
> JSON parameter needs to be valid JSON

It usually means:
- you didn’t use `JSON.stringify`, or
- you’re mixing raw JSON + JS syntax

Fix: use the template above exactly: `{{ JSON.stringify((() => { ... })()) }}`

---

### Pitfall 3 — types arrive as strings
If your incoming data has `"0"`, `"false"`, `"1"`, convert before sending:
- `Number(value)`
- `String(value) === "true"`

Do **not** send `"false"` when backend expects boolean.

---

## Recommended conventions for PKM API requests

### Use null for “missing”
- ✅ `null`
- ❌ `"NULL"`
- ❌ `""` (unless empty string is meaningful)

### Avoid overwriting text with empty strings
Only send `clean_text`, `extracted_text`, etc. if non-empty.

### Nested JSON fields
- Send as object or null:
  - `metadata: { retrieval: ... }`
- Avoid sending huge blobs unless necessary (log sizes/hashes if tracing).

### “returning”
Always include a small returning list for debugging:
- `id`, `entry_id`, timestamps, and one derived length field

---

## Example: DB Update request (working pattern)
```js
{{ JSON.stringify((() => {
  const id = $json.id;

  const retrieval = $json.retrieval ?? null;
  const q = retrieval?.quality ?? {};

  const body = {
    id,
    url_canonical: $json.url_canonical ?? null,
    metadata: retrieval ? { retrieval } : null,
    retrieval_excerpt: retrieval?.excerpt ?? null,
    retrieval_version: retrieval?.version ?? null,
    source_domain: retrieval?.source_domain ?? null,
    clean_word_count: q.clean_word_count ?? null,
    clean_char_count: q.clean_char_count ?? null,
    quality_score: q.quality_score ?? null,
    returning: ["id", "entry_id", "COALESCE(char_length(clean_text),0) AS clean_len"]
  };

  const clean = String($json.clean_text ?? "").trim();
  if (clean) body.clean_text = clean;

  return body;
})()) }}
```
