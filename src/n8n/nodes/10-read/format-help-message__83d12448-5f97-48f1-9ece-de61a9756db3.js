'use strict';

const { mdv2Message } = require('@igasovic/n8n-blocks/shared/telegram-markdown.js');

module.exports = async function run(ctx) {
  const { $json } = ctx;
const msg = `Commands:
/help
/pull <id> [--excerpt]
/recipe <R<number>|query>
/recipes <query>
/recipe-save <structured_recipe_text>
/recipe-link <public_id_1> <public_id_2>
/recipe-note <public_id> <note>
/last "query" [--days N] [--limit M]
/find "needle" [--days N] [--limit M]
/continue topic [--days N] [--limit M]
/with person topic [--days N] [--limit M]
/delete <prod|test> <id|id1,id2|from-to> [--dry-run] [--force]
/move <prod|test> <prod|test> <id|id1,id2|from-to> [--dry-run] [--force]
/debug <run_id|last>
/distill <entry_id>
/distill-run [--batch|--sync] [--dry-run] [--candidate-limit N] [--max-sync-items N] [--no-persist-eligibility]
/status [t1|t2] [--limit M] [--active-only]

Tips:
- Every result shows #<id> so you can /pull it.
- Reduce --limit if messages truncate.`;

  return [{ json: { ...$json, telegram_message: mdv2Message(msg) } }];
};
