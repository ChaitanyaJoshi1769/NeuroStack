# NeuroStack

**AI-Native Data + Intelligence Operating System**

An open-source, production-grade platform that unifies structured data, vector intelligence, semantic context, analytics, autonomous agents, and operational workflows into a cohesive system.

## 🎯 Vision

NeuroStack reimagines how organizations work with data and intelligence. Rather than bolting AI onto existing data infrastructure, NeuroStack is built from the ground up as an AI-native system where:

- **Data flows through semantic understanding** - Every query understands business context
- **Intelligence is autonomous** - Agents discover insights without explicit programming
- **Reasoning is explicit** - A knowledge graph captures organizational wisdom
- **Workflows are intelligent** - Orchestration adapts based on data and context

## 🏗️ Architecture

### Layered System Design

```
┌─────────────────────────────────────────────────────────────┐
│                    Applications Layer                        │
│        (Dashboards, APIs, External Integrations)            │
├─────────────────────────────────────────────────────────────┤
│                Intelligence Layer (Phase 2) 🟢 IN PROGRESS  │
│  Analytics  Context Resolution  Query Optimization           │
│  Knowledge Graph  Agentic Workflows                         │
├─────────────────────────────────────────────────────────────┤
│              Operational Layer (Phase 1) ✅ COMPLETE         │
│  Data Query Engine  Vector Runtime  Agent Framework          │
│  Memory Systems  Data Lineage  Semantic Engine              │
├─────────────────────────────────────────────────────────────┤
│                Infrastructure Layer                          │
│  PostgreSQL  Redis  Qdrant  Neo4j  Kafka  Prometheus       │
└─────────────────────────────────────────────────────────────┘
```

## 📦 Monorepo Structure

```
NeuroStack/
├── packages/
│   ├── shared/                      # Shared types and utilities
│   ├── semantic-engine/             # Business context and definitions
│   ├── vector-runtime/              # Vector embeddings and search
│   ├── agent-core/                  # Agent framework
│   ├── memory-system/               # Memory management
│   ├── data-lineage/                # Data lineage tracking
│   ├── hybrid-query-engine/         # SQL + Vector query engine
│   │
│   ├── analytics-engine/        (Phase 2) # Autonomous analytics
│   ├── context-engine/          (Phase 2) # Semantic context resolution
│   ├── query-optimizer/         (Phase 2) # Query planning & optimization
│   ├── knowledge-graph/         (Phase 2) # Enterprise reasoning
│   └── workflow-engine/         (Phase 2) # Agentic orchestration
│
├── apps/
│   ├── api/                         # FastAPI backend
│   ├── query-runtime/               # Rust query execution
│   ├── agent-orchestrator/          # Agent coordination
│   └── web/                         # Next.js frontend
│
├── infrastructure/
│   ├── docker/                      # Multi-stage Docker builds
│   └── terraform/                   # IaC for AWS EKS
│
├── .github/workflows/               # CI/CD pipeline
└── docs/                            # Development guides

```

## 🚀 Quick Start

### Prerequisites

- Node.js 18+
- Docker & Docker Compose
- Python 3.11+
- Rust 1.74+

### Local Development

```bash
# Install dependencies
pnpm install

# Start local services (PostgreSQL, Redis, Qdrant, Neo4j, etc.)
docker-compose up -d

# Build all packages
pnpm run build

# Run development servers
pnpm run dev

# Run tests
pnpm run test

# Lint and format
pnpm run lint
pnpm run format
```

### Accessing Services

- **Web UI**: http://localhost:3000
- **API**: http://localhost:8000
- **Query Runtime**: http://localhost:3002
- **Agent Orchestrator**: http://localhost:3001
- **Prometheus**: http://localhost:9090
- **Grafana**: http://localhost:3001
- **PostgreSQL**: localhost:5432
- **Redis**: localhost:6379
- **Qdrant**: localhost:6333
- **Neo4j**: http://localhost:7474

## 📊 Phase Progress

### Phase 1: Operational Foundation ✅ COMPLETE

**Goal**: Build core data and operational infrastructure

**Delivered**:
- ✅ Hybrid SQL + Vector Query Engine
- ✅ Vector Runtime with embeddings and semantic search
- ✅ Agent Framework with execution lifecycle
- ✅ Memory System (Episodic, Semantic, Procedural)
- ✅ Data Lineage tracking with impact analysis
- ✅ Semantic Engine for business definitions
- ✅ Multi-service architecture (FastAPI, Rust, Node.js, Next.js)
- ✅ Docker containerization and Kubernetes deployment
- ✅ CI/CD pipeline with GitHub Actions
- ✅ Comprehensive monitoring and observability

**Stats**: 64 source files, 10 packages, 4 applications, 8000+ lines of core code

### Phase 2: Intelligence Layer 🟢 IN PROGRESS

**Goal**: Build autonomous analytics, reasoning, and orchestration

**Delivered** (2.1 - Intelligence Foundations):
- ✅ Analytics Engine - Autonomous insight generation (anomaly, trend, correlation, forecasting)
- ✅ Context Engine - Semantic context resolution with intent detection
- ✅ Query Optimizer - Intelligent query planning and optimization
- ✅ Knowledge Graph - Enterprise semantic reasoning with graph traversal
- ✅ Workflow Engine - Agentic workflow orchestration with DAG execution

**In Progress** (2.2 - API Integration):
- 🔄 Integrating Intelligence packages into API service
- 🔄 Building analytics and workflow dashboards
- 🔄 Advanced agent types (Insight, Optimization, Diagnostics)
- 🔄 Vector-based semantic matching integration

**Planned** (2.3 - Autonomous Capabilities):
- Advanced machine learning insights
- Self-optimizing queries
- Autonomous workflow generation
- Agentic BI dashboards

### Phase 3: Advanced Reasoning (Future)

- Causal inference and counterfactual analysis
- Multi-agent collaborative reasoning
- Federated learning integration
- Custom domain reasoning plugins

### Phase 4: Production Hardening (Future)

- Advanced security and compliance
- Enterprise features and governance
- High-performance optimization
- Global deployment architecture

## 🧠 Core Concepts

### Semantic Layer

Every query is understood in business context. The semantic engine maintains:
- Metric definitions with calculation logic
- Dimension hierarchies and relationships
- Entity definitions and attributes
- Business rules and constraints

### Vector Intelligence

Beyond keyword search - semantic search across all data:
- Multi-source embeddings (metrics, documents, code examples)
- Hybrid search combining keyword and semantic relevance
- Memory vector management for agent context
- Efficient retrieval with filtering and ranking

### Agentic Framework

Autonomous agents that discover insights and execute workflows:
- Base agent architecture with tool registration
- Specialized agents (Analytics, Data Quality, Orchestration)
- Memory-augmented reasoning with context assembly
- Execution step tracking with error recovery

### Knowledge Graph

Enterprise reasoning through entity relationships:
- Entity types (metrics, dimensions, processes, systems, users)
- Relationship types (depends on, impacts, contains, derives from, correlates with)
- Graph traversal for impact analysis
- Transitive closure for dependency inference
- Pattern matching for knowledge discovery

### Intelligent Workflows

Orchestration that understands your data:
- DAG-based workflow definition with 7 step types
- Intent-aware routing to specialized agents
- Adaptive error handling with exponential backoff
- Execution planning with parallel optimization
- Context-aware step inputs and outputs

## 🔌 API Design

### RESTful API (FastAPI)

```bash
# Analytics
POST   /api/v2/analytics/generate-insights
GET    /api/v2/analytics/insights/{datasetId}

# Context Resolution
POST   /api/v2/context/assemble

# Query Optimization
POST   /api/v2/optimize/query

# Knowledge Graph
POST   /api/v2/knowledge-graph/entities
POST   /api/v2/knowledge-graph/relationships
GET    /api/v2/knowledge-graph/paths

# Workflows
POST   /api/v2/workflows/define
POST   /api/v2/workflows/{id}/execute
GET    /api/v2/workflows/{id}/execution/{execId}

# Historical (Phase 1)
POST   /api/v1/query
GET    /api/v1/metrics
POST   /api/v1/agents/execute
POST   /api/v1/memory/store
GET    /api/v1/memory/retrieve
GET    /api/v1/lineage/{entityId}
```

## 🔒 Security & Governance

- Multi-tenant architecture with complete data isolation
- Role-based access control (RBAC)
- Audit logging for all operations
- Encryption at rest and in transit
- Data lineage for compliance tracking
- API key and OAuth 2.0 authentication

## 📈 Performance Targets

| Component | Target | Status |
|-----------|--------|--------|
| Query Execution | < 100ms | ✅ |
| Vector Search | < 500ms | ✅ |
| Insight Generation | < 2s (100K rows) | 🔄 |
| Context Assembly | < 500ms | 🔄 |
| Workflow Step | < 5s | 🔄 |
| Knowledge Graph Traversal | < 100ms | 🔄 |

## 🛠️ Technology Stack

### Core Services
- **Query Engine**: PostgreSQL + Qdrant Vector DB
- **Analytics**: FastAPI (Python)
- **Query Runtime**: Rust with Tokio async
- **Agent Orchestration**: Express.js
- **Frontend**: Next.js 15 + React 19

### Infrastructure
- **Containerization**: Docker with multi-stage builds
- **Orchestration**: Kubernetes
- **Message Queue**: Apache Kafka
- **Monitoring**: Prometheus + Grafana
- **Tracing**: OpenTelemetry (ready)
- **Logging**: Pino structured logging

### Development
- **Language**: TypeScript with strict mode
- **Build System**: Turborepo for monorepo
- **Testing**: Jest
- **Code Quality**: ESLint + Prettier
- **CI/CD**: GitHub Actions

## 📚 Documentation

- [Architecture Guide](./ARCHITECTURE.md) - System design and patterns
- [Phase 1 Summary](./PHASE1_SUMMARY.md) - Operational foundation details
- [Phase 2 Progress](./PHASE2_PROGRESS.md) - Intelligence layer status
- [Development Guide](./docs/DEVELOPMENT.md) - Local setup and workflow
- [Deployment Guide](./docs/DEPLOYMENT.md) - Production deployment
- [Contributing Guidelines](./CONTRIBUTING.md) - How to contribute

## 🤝 Contributing

We welcome contributions! See [CONTRIBUTING.md](./CONTRIBUTING.md) for:
- Development workflow
- Coding standards
- Commit message format
- PR review process
- Areas where help is needed

## 📜 License

MIT License - See LICENSE file for details

## 🙋 Support

- **Issues**: GitHub Issues for bug reports and feature requests
- **Discussions**: GitHub Discussions for questions and ideas
- **Email**: contact@neurostack.dev (placeholder)

## 🎯 Roadmap

**Q2 2026** (Current)
- Complete Phase 2 Intelligence Layer
- Build analytics and workflow UIs
- Integrate advanced agent types

**Q3 2026**
- Phase 3: Advanced reasoning and causal inference
- Multi-agent collaboration
- Enterprise features

**Q4 2026**
- Phase 4: Production hardening
- Global deployment support
- Enterprise security compliance

## 👥 Team

Built with ❤️ by a team passionate about making data intelligence accessible and autonomous.

## 🌟 Acknowledgments

Built on top of amazing open-source projects:
- PostgreSQL, Redis, Qdrant, Neo4j
- FastAPI, Express.js, Next.js
- Turborepo, TypeScript, Rust
- And many more...

---

**Ready to transform data into intelligence?** Start with the [Quick Start](#-quick-start) guide above or explore the [Architecture](./ARCHITECTURE.md) to understand how NeuroStack works.

Last Updated: 2026-05-25  
Current Version: Phase 2 (v0.2.0)
