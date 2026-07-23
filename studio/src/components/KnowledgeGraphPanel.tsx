export interface StudioGraphNode {
  id: string;
  label: string;
  type: string;
  timestamp?: string;
  status?: string;
}

export interface KnowledgeGraphPanelProps {
  title: string;
  rootId: string;
  nodes: StudioGraphNode[];
  onSelect?: (nodeId: string) => void;
}

/** Context-sensitive Studio graph panel compatible with Cytoscape node data. */
export function KnowledgeGraphPanel({ title, rootId, nodes, onSelect }: KnowledgeGraphPanelProps): React.JSX.Element {
  return (
    <aside aria-label={title} data-graph-engine="cytoscape" className="graph-panel">
      <h2>{title}</h2>
      <p>{nodes.length} related items</p>
      <ul>
        {nodes.map(node => (
          <li key={node.id}>
            <button type="button" aria-pressed={node.id === rootId} onClick={() => onSelect?.(node.id)}>
              <strong>{node.label}</strong>
              <span>{node.type}{node.status ? ` · ${node.status}` : ''}</span>
              {node.timestamp ? <time dateTime={node.timestamp}>{new Date(node.timestamp).toLocaleString()}</time> : null}
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}
