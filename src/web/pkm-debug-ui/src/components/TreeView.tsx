import type { TreeNode } from '../types';
import { fmtDuration } from '../lib/format';

interface TreeViewProps {
  nodes: TreeNode[];
  selectedId: string | null;
  onSelect: (node: TreeNode) => void;
}

function statusDot(status: string): string {
  if (status === 'ok') return 'bg-emerald-400';
  if (status === 'error' || status === 'orphan_error') return 'bg-rose-400';
  if (status === 'missing_end' || status === 'orphan_end') return 'bg-amber-400';
  return 'bg-slate-400';
}

function TreeNodeRow({ node, selectedId, onSelect }: { node: TreeNode; selectedId: string | null; onSelect: (node: TreeNode) => void }) {
  const selected = selectedId === node.id;
  return (
    <>
      <div
        className={`flex cursor-pointer items-start gap-2 border-b border-slate-900 px-3 py-2 text-sm ${selected ? 'bg-slate-800/80' : 'hover:bg-slate-800/50'}`}
        style={{ paddingLeft: `${0.75 + node.depth * 1.1}rem` }}
        onClick={() => onSelect(node)}
      >
        <span className={`mt-1 h-2.5 w-2.5 rounded-full ${statusDot(node.status)}`} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-slate-100" title={node.step}>{node.step || '-'}</div>
          <div className="truncate text-xs text-slate-400" title={node.pipeline}>{node.pipeline || '-'}</div>
        </div>
        <div className="text-xs text-slate-300">{fmtDuration(node.duration_ms)}</div>
      </div>
      {node.children.map((child) => (
        <TreeNodeRow key={child.id} node={child} selectedId={selectedId} onSelect={onSelect} />
      ))}
    </>
  );
}

export function TreeView({ nodes, selectedId, onSelect }: TreeViewProps) {
  return (
    <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/70 shadow-glow">
      {nodes.length === 0 ? (
        <div className="px-3 py-4 text-sm text-slate-400">No events.</div>
      ) : (
        nodes.map((node) => <TreeNodeRow key={node.id} node={node} selectedId={selectedId} onSelect={onSelect} />)
      )}
    </div>
  );
}
