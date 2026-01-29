#!/usr/bin/env python3
import json, os, re, sys, glob

def die(msg):
    print(msg, file=sys.stderr)
    sys.exit(1)

if len(sys.argv) != 4:
    die("Usage: patch_workflow_use_external_js.py <workflow_json> <js_dir> <workflow_slug>")

wf_path, js_dir, workflow_slug = sys.argv[1], sys.argv[2], sys.argv[3]

if not os.path.exists(wf_path):
    die(f"Missing workflow json: {wf_path}")
if not os.path.isdir(js_dir):
    die(f"Missing js dir: {js_dir}")

# Map node_id -> js filename from files like: 02_build-sql-last__<node-id>.js
mapping = {}
for p in glob.glob(os.path.join(js_dir, "*.js")):
    base = os.path.basename(p)
    m = re.search(r"__([0-9a-fA-F-]{36})\.js$", base)
    if not m:
        continue
    node_id = m.group(1)
    mapping[node_id] = base

if not mapping:
    die(f"No node-id mapped js files found in {js_dir}")

with open(wf_path, "r", encoding="utf-8") as f:
    data = json.load(f)

# n8n export may be a single workflow object OR an array of workflows
workflows = data if isinstance(data, list) else [data]

total_patched = 0
total_skipped = 0

for wf in workflows:
    nodes = wf.get("nodes", [])
    for n in nodes:
        if n.get("type") != "n8n-nodes-base.code":
            continue
        nid = n.get("id")
        if not nid:
            total_skipped += 1
            continue
        fn = mapping.get(nid)
        if not fn:
            total_skipped += 1
            continue

        wrapper = (
            f"try{{const fn=require('/data/js/workflows/{workflow_slug}/{fn}');"
            f"return await fn({{$input,$json,$items,$node,$env,helpers}});}}"
            f"catch(e){{e.message=`[extjs:{workflow_slug}/{fn}] ${{e.message}}`;throw e;}}"
        )
        n.setdefault("parameters", {})["jsCode"] = wrapper
        total_patched += 1

out_path = os.path.join("tmp", f"{workflow_slug}.raw.externalized.json")
os.makedirs("tmp", exist_ok=True)
with open(out_path, "w", encoding="utf-8") as f:
    json.dump(data, f, indent=2)

print(f"Patched code nodes: {total_patched}, skipped: {total_skipped}")
print(f"Wrote: {out_path}")
