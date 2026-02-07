/**
 * n8n Code node wrapper template (single line)
 *
 * Paste into the n8n Code node.
 * Replace <workflow-slug> and <file>.js only.
 *
 * Example:
 * try{const fn=require('/data/js/workflows/pkm-retrieval-config/return_scoring_config_v1.js');return await fn({$input,$json,$items,$node,$env,helpers});}catch(e){e.message=`[extjs:pkm-retrieval-config/return_scoring_config_v1.js] ${e.message}`;throw e;}
 */

'use strict';

module.exports = {
  codeNodeOneLiner: "try{const fn=require('/data/js/workflows/<workflow-slug>/<file>.js');return await fn({$input,$json,$items,$node,$env,helpers});}catch(e){e.message=`[extjs:<workflow-slug>/<file>.js] ${e.message}`;throw e;}"
};
