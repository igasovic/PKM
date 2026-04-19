'use strict';

const BACKEND_ROUTE_REGISTRY = [
  {
    "method": "GET",
    "path": "/health",
    "auth": "none",
    "doc": "docs/api_control.md",
    "primary_callers": ["operators", "probes"],
    "tests": ["test/server/control.api-contract.test.js"]
  },
  {
    "method": "GET",
    "path": "/ready",
    "auth": "none",
    "doc": "docs/api_control.md",
    "primary_callers": ["operators", "probes"],
    "tests": ["test/server/control.api-contract.test.js"]
  },
  {
    "method": "GET",
    "path": "/version",
    "auth": "none",
    "doc": "docs/api_control.md",
    "primary_callers": ["operators", "probes"],
    "tests": ["test/server/control.api-contract.test.js"]
  },
  {
    "method": "GET",
    "path": "/config",
    "auth": "none",
    "doc": "docs/api_control.md",
    "primary_callers": ["operators", "debug UI"],
    "tests": ["test/server/control.api-contract.test.js"]
  },
  {
    "method": "POST",
    "path": "/chatgpt/working_memory",
    "auth": "admin_secret",
    "doc": "docs/api_control.md",
    "primary_callers": ["11 ChatGPT Read Router"],
    "tests": ["test/server/chatgpt.api-contract.test.js"]
  },
  {
    "method": "POST",
    "path": "/chatgpt/wrap-commit",
    "auth": "admin_secret",
    "doc": "docs/api_control.md",
    "primary_callers": ["05 ChatGPT Wrap Commit"],
    "tests": ["test/server/chatgpt.api-contract.test.js"]
  },
  {
    "method": "POST",
    "path": "/chatgpt/topic-state",
    "auth": "admin_secret",
    "doc": "docs/api_control.md",
    "primary_callers": ["PKM UI Working Memory page"],
    "tests": ["test/server/chatgpt.api-contract.test.js"]
  },
  {
    "method": "POST",
    "path": "/normalize/telegram",
    "auth": "internal",
    "doc": "docs/api_ingest.md",
    "primary_callers": ["Telegram ingest workflows"],
    "tests": ["test/server/classify.api-contract.test.js"],
    "smoke": {
      "enabled": true,
      "expected_status": 200,
      "body": {
        "text": "pkm hello from telegram",
        "source": { "chat_id": "1509032341", "message_id": "777" }
      }
    }
  },
  {
    "method": "POST",
    "path": "/ingest/telegram/url-batch",
    "auth": "internal",
    "doc": "docs/api_ingest.md",
    "primary_callers": ["Telegram ingest workflows"],
    "tests": ["test/server/classify.api-contract.test.js", "test/server/telegram-url-batch-ingest.test.js"]
  },
  {
    "method": "POST",
    "path": "/normalize/email/intent",
    "auth": "internal",
    "doc": "docs/api_ingest.md",
    "primary_callers": ["Email ingest workflows"],
    "tests": ["test/server/classify.api-contract.test.js"]
  },
  {
    "method": "POST",
    "path": "/normalize/email",
    "auth": "internal",
    "doc": "docs/api_ingest.md",
    "primary_callers": ["Email ingest workflows"],
    "tests": ["test/server/classify.api-contract.test.js"],
    "smoke": {
      "enabled": true,
      "expected_status": 200,
      "body": {
        "raw_text": "hello from email",
        "from": "user@example.com",
        "subject": "Inbox item"
      }
    }
  },
  {
    "method": "POST",
    "path": "/normalize/webpage",
    "auth": "internal",
    "doc": "docs/api_ingest.md",
    "primary_callers": ["Web capture workflows"],
    "tests": ["test/server/classify.api-contract.test.js"]
  },
  {
    "method": "POST",
    "path": "/normalize/notion",
    "auth": "internal",
    "doc": "docs/api_ingest.md",
    "primary_callers": ["Notion ingest workflows"],
    "tests": ["test/server/classify.api-contract.test.js"]
  },
  {
    "method": "POST",
    "path": "/enrich/t1",
    "auth": "internal",
    "doc": "docs/api_ingest.md",
    "primary_callers": ["Classify workflows"],
    "tests": ["test/server/classify.api-contract.test.js"],
    "smoke": {
      "enabled": true,
      "expected_status": 200,
      "body": {
        "title": "Newsletter",
        "author": "PKM",
        "clean_text": "This is enough text to classify."
      }
    }
  },
  {
    "method": "POST",
    "path": "/enrich/t1/batch",
    "auth": "internal",
    "doc": "docs/api_ingest.md",
    "primary_callers": ["Classify batch workflows"],
    "tests": ["test/server/classify.api-contract.test.js"]
  },
  {
    "method": "POST",
    "path": "/enrich/t1/run",
    "auth": "internal",
    "doc": "docs/api_ingest.md",
    "primary_callers": ["Legacy compatibility callers"],
    "tests": ["test/server/classify.api-contract.test.js"]
  },
  {
    "method": "POST",
    "path": "/pkm/classify/batch",
    "auth": "internal",
    "doc": "docs/api_ingest.md",
    "primary_callers": ["10 Read (/classify)"],
    "tests": ["test/server/classify.api-contract.test.js"]
  },
  {
    "method": "POST",
    "path": "/enrich/t1/update",
    "auth": "internal",
    "doc": "docs/api_ingest.md",
    "primary_callers": ["21 Tier-1 Enrichment"],
    "tests": ["test/server/classify.api-contract.test.js"]
  },
  {
    "method": "POST",
    "path": "/pkm/classify",
    "auth": "internal",
    "doc": "docs/api_ingest.md",
    "primary_callers": ["02 Telegram Capture", "03 E-Mail Capture", "04 Notion Capture", "22 Web Extraction"],
    "tests": ["test/server/classify.api-contract.test.js"],
    "smoke": {
      "enabled": true,
      "expected_status": 200,
      "body": {
        "entry_id": 101,
        "clean_text": "This is enough text to classify."
      }
    }
  },
  {
    "method": "POST",
    "path": "/enrich/t1/update-batch",
    "auth": "internal",
    "doc": "docs/api_ingest.md",
    "primary_callers": ["Classify workflows"],
    "tests": ["test/server/classify.api-contract.test.js"]
  },
  {
    "method": "GET",
    "path": "/status/t1/batch",
    "auth": "internal",
    "doc": "docs/api_ingest.md",
    "primary_callers": ["Classify batch workflows"],
    "tests": ["test/server/classify.api-contract.test.js"]
  },
  {
    "method": "GET",
    "path": "/status/t1/batch/:batch_id",
    "auth": "internal",
    "doc": "docs/api_ingest.md",
    "primary_callers": ["Classify batch workflows"],
    "tests": ["test/server/classify.api-contract.test.js"]
  },
  {
    "method": "POST",
    "path": "/telegram/route",
    "auth": "admin_secret",
    "doc": "docs/api_calendar.md",
    "primary_callers": ["Family calendar router workflows"],
    "tests": ["test/server/calendar.api-contract.test.js"],
    "smoke": {
      "enabled": true,
      "expected_status": 200,
      "body": {
        "text": "cal: Mila dentist tomorrow 3pm",
        "actor_code": "igor",
        "source": { "chat_id": "1509032341", "message_id": "777" }
      }
    }
  },
  {
    "method": "POST",
    "path": "/calendar/normalize",
    "auth": "admin_secret",
    "doc": "docs/api_calendar.md",
    "primary_callers": ["Family calendar normalize workflows"],
    "tests": ["test/server/calendar.api-contract.test.js"],
    "smoke": {
      "enabled": true,
      "expected_status": 200,
      "body": {
        "raw_text": "Mila dentist tomorrow 3pm",
        "actor_code": "igor",
        "source": { "chat_id": "1509032341", "message_id": "777" }
      }
    }
  },
  {
    "method": "POST",
    "path": "/calendar/finalize",
    "auth": "admin_secret",
    "doc": "docs/api_calendar.md",
    "primary_callers": ["Family calendar finalize workflows"],
    "tests": ["test/server/calendar.api-contract.test.js"]
  },
  {
    "method": "POST",
    "path": "/calendar/observe",
    "auth": "admin_secret",
    "doc": "docs/api_calendar.md",
    "primary_callers": ["Family calendar observe workflows"],
    "tests": ["test/server/calendar.api-contract.test.js"]
  },
  {
    "method": "POST",
    "path": "/distill/sync",
    "auth": "admin_secret",
    "doc": "docs/api_distill.md",
    "primary_callers": ["Distill workflows", "operators"],
    "tests": ["test/server/tier2.api-contract.test.js"]
  },
  {
    "method": "POST",
    "path": "/distill/plan",
    "auth": "admin_secret",
    "doc": "docs/api_distill.md",
    "primary_callers": ["Distill workflows", "operators"],
    "tests": ["test/server/tier2.api-contract.test.js"]
  },
  {
    "method": "POST",
    "path": "/distill/run",
    "auth": "admin_secret",
    "doc": "docs/api_distill.md",
    "primary_callers": ["Distill workflows", "operators"],
    "tests": ["test/server/tier2.api-contract.test.js"],
    "smoke": {
      "enabled": true,
      "expected_status": 200,
      "body": {
        "dry_run": true,
        "max_sync_items": 1
      }
    }
  },
  {
    "method": "GET",
    "path": "/status/batch",
    "auth": "internal",
    "doc": "docs/api_distill.md",
    "primary_callers": ["Distill batch workflows", "operators"],
    "tests": ["test/server/tier2.api-contract.test.js"]
  },
  {
    "method": "GET",
    "path": "/status/batch/:batch_id",
    "auth": "internal",
    "doc": "docs/api_distill.md",
    "primary_callers": ["Distill batch workflows", "operators"],
    "tests": ["test/server/tier2.api-contract.test.js"]
  },
  {
    "method": "POST",
    "path": "/import/email/mbox",
    "auth": "internal",
    "doc": "docs/api_ingest.md",
    "primary_callers": ["Backlog import workflows"],
    "tests": ["test/server/classify.api-contract.test.js"],
    "smoke": {
      "enabled": true,
      "expected_status": 200,
      "body": {
        "mbox_path": "sample.mbox",
        "max_emails": 1
      }
    }
  },
  {
    "method": "POST",
    "path": "/debug/failures",
    "auth": "admin_secret",
    "doc": "docs/api_control.md",
    "primary_callers": ["WF99", "operators"],
    "tests": ["test/server/failure-pack.api-contract.test.js"]
  },
  {
    "method": "GET",
    "path": "/debug/failures",
    "auth": "admin_secret",
    "doc": "docs/api_control.md",
    "primary_callers": ["operators", "debug UI"],
    "tests": ["test/server/failure-pack.api-contract.test.js"]
  },
  {
    "method": "GET",
    "path": "/debug/failures/open",
    "auth": "admin_secret",
    "doc": "docs/api_control.md",
    "primary_callers": ["PKM UI Failures page", "n8n failure webhook facade"],
    "tests": ["test/server/failure-pack.api-contract.test.js"]
  },
  {
    "method": "GET",
    "path": "/debug/failures/by-run/:run_id",
    "auth": "admin_secret",
    "doc": "docs/api_control.md",
    "primary_callers": ["operators", "debug UI"],
    "tests": ["test/server/control.api-contract.test.js"]
  },
  {
    "method": "GET",
    "path": "/debug/failures/:failure_id",
    "auth": "admin_secret",
    "doc": "docs/api_control.md",
    "primary_callers": ["operators", "debug UI"],
    "tests": ["test/server/failure-pack.api-contract.test.js"]
  },
  {
    "method": "POST",
    "path": "/debug/failures/:failure_id/analyze",
    "auth": "admin_secret",
    "doc": "docs/api_control.md",
    "primary_callers": ["PKM UI Failures page", "n8n failure webhook facade"],
    "tests": ["test/server/failure-pack.api-contract.test.js"]
  },
  {
    "method": "POST",
    "path": "/debug/failures/:failure_id/resolve",
    "auth": "admin_secret",
    "doc": "docs/api_control.md",
    "primary_callers": ["PKM UI Failures page"],
    "tests": ["test/server/failure-pack.api-contract.test.js"]
  },
  {
    "method": "GET",
    "path": "/debug/failure-bundle/:run_id",
    "auth": "admin_secret",
    "doc": "docs/api_control.md",
    "primary_callers": ["operators", "debug UI"],
    "tests": ["test/server/control.api-contract.test.js"]
  },
  {
    "method": "GET",
    "path": "/debug/run/last",
    "auth": "admin_secret",
    "doc": "docs/api_control.md",
    "primary_callers": ["operators", "debug UI"],
    "tests": ["test/server/control.api-contract.test.js"]
  },
  {
    "method": "GET",
    "path": "/debug/runs",
    "auth": "admin_secret",
    "doc": "docs/api_control.md",
    "primary_callers": ["operators", "debug UI"],
    "tests": ["test/server/control.api-contract.test.js"]
  },
  {
    "method": "GET",
    "path": "/debug/run/:run_id",
    "auth": "admin_secret",
    "doc": "docs/api_control.md",
    "primary_callers": ["operators", "debug UI"],
    "tests": ["test/server/control.api-contract.test.js"]
  },
  {
    "method": "GET",
    "path": "/db/test-mode",
    "auth": "none",
    "doc": "docs/api_control.md",
    "primary_callers": ["operators", "debug UI"],
    "tests": ["test/server/control.api-contract.test.js"]
  },
  {
    "method": "POST",
    "path": "/db/test-mode/toggle",
    "auth": "internal",
    "doc": "docs/api_control.md",
    "primary_callers": ["operators", "debug UI"],
    "tests": ["test/server/read-write.api-contract.test.js"]
  },
  {
    "method": "POST",
    "path": "/echo",
    "auth": "none",
    "doc": "docs/api_control.md",
    "primary_callers": ["operators", "smoke workflows"],
    "tests": ["test/server/control.api-contract.test.js"]
  },
  {
    "method": "POST",
    "path": "/recipes/create",
    "auth": "internal",
    "doc": "docs/api_recipes.md",
    "primary_callers": ["Telegram recipe workflows", "debug UI"],
    "tests": ["test/server/recipes.api-contract.test.js"]
  },
  {
    "method": "POST",
    "path": "/recipes/search",
    "auth": "internal",
    "doc": "docs/api_recipes.md",
    "primary_callers": ["Telegram recipe workflows", "debug UI"],
    "tests": ["test/server/recipes.api-contract.test.js"]
  },
  {
    "method": "POST",
    "path": "/recipes/get",
    "auth": "internal",
    "doc": "docs/api_recipes.md",
    "primary_callers": ["Telegram /recipe command", "debug UI"],
    "tests": ["test/server/recipes.api-contract.test.js"]
  },
  {
    "method": "POST",
    "path": "/recipes/patch",
    "auth": "internal",
    "doc": "docs/api_recipes.md",
    "primary_callers": ["debug UI", "operators"],
    "tests": ["test/server/recipes.api-contract.test.js"]
  },
  {
    "method": "POST",
    "path": "/recipes/overwrite",
    "auth": "internal",
    "doc": "docs/api_recipes.md",
    "primary_callers": ["debug UI", "operators"],
    "tests": ["test/server/recipes.api-contract.test.js"]
  },
  {
    "method": "POST",
    "path": "/recipes/link",
    "auth": "internal",
    "doc": "docs/api_recipes.md",
    "primary_callers": ["Telegram /recipe-link command", "debug UI"],
    "tests": ["test/server/recipes.api-contract.test.js"]
  },
  {
    "method": "POST",
    "path": "/recipes/note",
    "auth": "internal",
    "doc": "docs/api_recipes.md",
    "primary_callers": ["Telegram /recipe-note command"],
    "tests": ["test/server/recipes.api-contract.test.js"]
  },
  {
    "method": "GET",
    "path": "/recipes/review",
    "auth": "internal",
    "doc": "docs/api_recipes.md",
    "primary_callers": ["debug UI", "operators"],
    "tests": ["test/server/recipes.api-contract.test.js"]
  },
  {
    "method": "POST",
    "path": "/todoist/sync",
    "auth": "internal",
    "doc": "docs/api_todoist.md",
    "primary_callers": ["34 Todoist Sync", "35 Todoist Daily Focus", "36 Todoist Waiting Radar", "37 Todoist Weekly Pruning"],
    "tests": ["test/server/todoist.api-contract.test.js"]
  },
  {
    "method": "GET",
    "path": "/todoist/review",
    "auth": "internal",
    "doc": "docs/api_todoist.md",
    "primary_callers": ["PKM UI /todoist", "operators"],
    "tests": ["test/server/todoist.api-contract.test.js"]
  },
  {
    "method": "POST",
    "path": "/todoist/review/accept",
    "auth": "internal",
    "doc": "docs/api_todoist.md",
    "primary_callers": ["PKM UI /todoist", "operators"],
    "tests": ["test/server/todoist.api-contract.test.js"]
  },
  {
    "method": "POST",
    "path": "/todoist/review/override",
    "auth": "internal",
    "doc": "docs/api_todoist.md",
    "primary_callers": ["PKM UI /todoist", "operators"],
    "tests": ["test/server/todoist.api-contract.test.js"]
  },
  {
    "method": "POST",
    "path": "/todoist/review/reparse",
    "auth": "internal",
    "doc": "docs/api_todoist.md",
    "primary_callers": ["PKM UI /todoist", "operators"],
    "tests": ["test/server/todoist.api-contract.test.js"]
  },
  {
    "method": "POST",
    "path": "/todoist/brief/daily",
    "auth": "internal",
    "doc": "docs/api_todoist.md",
    "primary_callers": ["35 Todoist Daily Focus"],
    "tests": ["test/server/todoist.api-contract.test.js"]
  },
  {
    "method": "POST",
    "path": "/todoist/brief/waiting",
    "auth": "internal",
    "doc": "docs/api_todoist.md",
    "primary_callers": ["36 Todoist Waiting Radar", "10 Read /waiting"],
    "tests": ["test/server/todoist.api-contract.test.js"]
  },
  {
    "method": "POST",
    "path": "/todoist/brief/weekly",
    "auth": "internal",
    "doc": "docs/api_todoist.md",
    "primary_callers": ["37 Todoist Weekly Pruning"],
    "tests": ["test/server/todoist.api-contract.test.js"]
  },
  {
    "method": "POST",
    "path": "/todoist/eval/normalize",
    "auth": "admin_secret",
    "doc": "docs/api_todoist.md",
    "primary_callers": ["Pi eval runner"],
    "tests": ["test/server/todoist.api-contract.test.js"]
  },
  {
    "method": "POST",
    "path": "/pkm/insert",
    "auth": "internal",
    "doc": "docs/api_read_write.md",
    "primary_callers": ["n8n capture workflows"],
    "tests": ["test/server/read-write.api-contract.test.js"],
    "smoke": {
      "enabled": true,
      "expected_status": 200,
      "body": {
        "source": "telegram",
        "intent": "archive",
        "content_type": "note",
        "capture_text": "hello from smoke",
        "clean_text": "hello from smoke",
        "idempotency_policy_key": "telegram_thought_v1",
        "idempotency_key_primary": "smoke:insert:telegram:hello",
        "idempotency_key_secondary": "smoke:insert:telegram:hello:v1",
        "metadata": {
          "smoke": {
            "suite": "route-registry"
          }
        }
      }
    }
  },
  {
    "method": "POST",
    "path": "/pkm/insert/batch",
    "auth": "internal",
    "doc": "docs/api_read_write.md",
    "primary_callers": ["batch ingest workflows", "email backlog import"],
    "tests": ["test/server/read-write.api-contract.test.js"],
    "smoke": {
      "enabled": true,
      "expected_status": 200,
      "body": {
        "continue_on_error": true,
        "items": [
          {
            "source": "telegram",
            "intent": "archive",
            "content_type": "note",
            "capture_text": "hello batch smoke",
            "clean_text": "hello batch smoke",
            "idempotency_policy_key": "telegram_thought_v1",
            "idempotency_key_primary": "smoke:insert-batch:telegram:hello",
            "idempotency_key_secondary": "smoke:insert-batch:telegram:hello:v1"
          }
        ]
      }
    }
  },
  {
    "method": "POST",
    "path": "/pkm/insert/enriched",
    "auth": "internal",
    "doc": "docs/api_read_write.md",
    "primary_callers": ["chatgpt wrap_commit", "enriched ingest workflows"],
    "tests": ["test/server/read-write.api-contract.test.js"],
    "smoke": {
      "enabled": true,
      "expected_status": 200,
      "body": {
        "source": "telegram",
        "intent": "thought",
        "content_type": "note",
        "capture_text": "hello enriched smoke",
        "clean_text": "hello enriched smoke",
        "idempotency_policy_key": "telegram_thought_v1",
        "idempotency_key_primary": "smoke:insert-enriched:telegram:hello",
        "idempotency_key_secondary": "smoke:insert-enriched:telegram:hello:v1",
        "gist": "enriched smoke gist"
      }
    }
  },
  {
    "method": "POST",
    "path": "/db/update",
    "auth": "internal",
    "doc": "docs/api_read_write.md",
    "primary_callers": ["n8n update workflows"],
    "tests": ["test/server/read-write.api-contract.test.js"]
  },
  {
    "method": "POST",
    "path": "/db/delete",
    "auth": "admin_secret",
    "doc": "docs/api_read_write.md",
    "primary_callers": ["operators"],
    "tests": ["test/server/read-write.api-contract.test.js"]
  },
  {
    "method": "POST",
    "path": "/db/move",
    "auth": "admin_secret",
    "doc": "docs/api_read_write.md",
    "primary_callers": ["operators"],
    "tests": ["test/server/read-write.api-contract.test.js"]
  },
  {
    "method": "POST",
    "path": "/db/read/continue",
    "auth": "internal",
    "doc": "docs/api_read_write.md",
    "primary_callers": ["11 ChatGPT Read Router", "read workflows"],
    "tests": ["test/server/read-write.api-contract.test.js"]
  },
  {
    "method": "POST",
    "path": "/db/read/find",
    "auth": "internal",
    "doc": "docs/api_read_write.md",
    "primary_callers": ["11 ChatGPT Read Router", "read workflows"],
    "tests": ["test/server/read-write.api-contract.test.js"]
  },
  {
    "method": "POST",
    "path": "/db/read/last",
    "auth": "internal",
    "doc": "docs/api_read_write.md",
    "primary_callers": ["11 ChatGPT Read Router", "read workflows"],
    "tests": ["test/server/read-write.api-contract.test.js"]
  },
  {
    "method": "POST",
    "path": "/db/read/pull",
    "auth": "internal",
    "doc": "docs/api_read_write.md",
    "primary_callers": ["11 ChatGPT Read Router", "read workflows"],
    "tests": ["test/server/read-write.api-contract.test.js"],
    "smoke": {
      "enabled": true,
      "expected_status": 200,
      "body": {
        "entry_id": 101,
        "longN": 500
      }
    }
  },
  {
    "method": "POST",
    "path": "/db/read/smoke",
    "auth": "internal",
    "doc": "docs/api_read_write.md",
    "primary_callers": ["smoke workflows"],
    "tests": ["test/server/db.read-smoke.api-contract.test.js"]
  },
  {
    "method": "POST",
    "path": "/db/read/entities",
    "auth": "internal",
    "doc": "docs/api_read_write.md",
    "primary_callers": ["PKM UI entities page"],
    "tests": ["test/server/read-write.api-contract.test.js"]
  }
]
;

module.exports = {
  BACKEND_ROUTE_REGISTRY,
};
