import pino from 'pino';
import { Lineage, LineageNode, LineageEdge } from '@neurostack/shared';
import { generateId } from '@neurostack/shared';

export class LineageEngine {
  private logger = pino();
  private lineages: Map<string, Lineage> = new Map();

  /**
   * Create or get lineage for a tenant
   */
  getLineage(tenantId: string): Lineage {
    let lineage = this.lineages.get(tenantId);
    if (!lineage) {
      lineage = {
        tenantId,
        nodes: [],
        edges: [],
      };
      this.lineages.set(tenantId, lineage);
    }
    return lineage;
  }

  /**
   * Add a node to lineage
   */
  addNode(tenantId: string, node: LineageNode): void {
    const lineage = this.getLineage(tenantId);
    const existing = lineage.nodes.find((n) => n.id === node.id);
    if (!existing) {
      lineage.nodes.push(node);
      this.logger.debug({ nodeId: node.id }, 'Lineage node added');
    }
  }

  /**
   * Add an edge to lineage
   */
  addEdge(tenantId: string, edge: LineageEdge): void {
    const lineage = this.getLineage(tenantId);
    const existing = lineage.edges.find(
      (e) => e.source === edge.source && e.target === edge.target
    );
    if (!existing) {
      lineage.edges.push(edge);
      this.logger.debug(
        { source: edge.source, target: edge.target },
        'Lineage edge added'
      );
    }
  }

  /**
   * Get upstream lineage
   */
  getUpstream(tenantId: string, nodeId: string): LineageNode[] {
    const lineage = this.getLineage(tenantId);
    const upstream: LineageNode[] = [];
    const visited = new Set<string>();

    const traverse = (id: string): void => {
      if (visited.has(id)) return;
      visited.add(id);

      const incomingEdges = lineage.edges.filter((e) => e.target === id);
      for (const edge of incomingEdges) {
        const sourceNode = lineage.nodes.find((n) => n.id === edge.source);
        if (sourceNode) {
          upstream.push(sourceNode);
          traverse(edge.source);
        }
      }
    };

    traverse(nodeId);
    return upstream;
  }

  /**
   * Get downstream lineage
   */
  getDownstream(tenantId: string, nodeId: string): LineageNode[] {
    const lineage = this.getLineage(tenantId);
    const downstream: LineageNode[] = [];
    const visited = new Set<string>();

    const traverse = (id: string): void => {
      if (visited.has(id)) return;
      visited.add(id);

      const outgoingEdges = lineage.edges.filter((e) => e.source === id);
      for (const edge of outgoingEdges) {
        const targetNode = lineage.nodes.find((n) => n.id === edge.target);
        if (targetNode) {
          downstream.push(targetNode);
          traverse(edge.target);
        }
      }
    };

    traverse(nodeId);
    return downstream;
  }

  /**
   * Get full lineage path
   */
  getFullLineage(tenantId: string, nodeId: string): Lineage {
    const lineage = this.getLineage(tenantId);
    const upstream = this.getUpstream(tenantId, nodeId);
    const downstream = this.getDownstream(tenantId, nodeId);
    const centerNode = lineage.nodes.find((n) => n.id === nodeId);

    const allNodeIds = new Set([
      ...upstream.map((n) => n.id),
      nodeId,
      ...downstream.map((n) => n.id),
    ]);

    const relevantEdges = lineage.edges.filter(
      (e) => allNodeIds.has(e.source) && allNodeIds.has(e.target)
    );

    return {
      tenantId,
      nodes: [...upstream, ...(centerNode ? [centerNode] : []), ...downstream],
      edges: relevantEdges,
    };
  }

  /**
   * Analyze impact of a change
   */
  analyzeImpact(tenantId: string, nodeId: string): Record<string, unknown> {
    const affected = this.getDownstream(tenantId, nodeId);

    return {
      nodeId,
      directDownstream: affected.length,
      affectedNodeIds: affected.map((n) => n.id),
      affectedTypes: Array.from(new Set(affected.map((n) => n.type))),
      severity: affected.length > 10 ? 'high' : affected.length > 0 ? 'medium' : 'low',
    };
  }
}

export { LineageNode, LineageEdge, Lineage };
