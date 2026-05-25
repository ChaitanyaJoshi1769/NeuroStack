# Development Guide

This guide covers local development setup and workflows for NeuroStack.

## Prerequisites

- Node.js 20+
- Docker & Docker Compose
- Python 3.11+ (for API development)
- Rust 1.74+ (for query runtime development)
- Git
- Code editor (VS Code recommended)

## Local Development Environment

### 1. Clone and Setup

```bash
# Clone repository
git clone https://github.com/ChaitanyaJoshi1769/NeuroStack.git
cd NeuroStack

# Install dependencies
npm install
```

### 2. Start Infrastructure

```bash
# Start all services (PostgreSQL, Redis, Kafka, etc.)
docker-compose up -d

# Verify services
docker-compose ps

# View logs
docker-compose logs -f
```

### 3. Build Packages

```bash
# Build all packages
npm run build

# Build specific package
npm run build -- --filter=@neurostack/semantic-engine

# Watch mode (rebuild on changes)
npm run dev
```

### 4. Start Services

**Terminal 1 - API Service**:
```bash
cd apps/api
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

**Terminal 2 - Query Runtime**:
```bash
cd apps/query-runtime
cargo run
```

**Terminal 3 - Agent Orchestrator**:
```bash
cd apps/agent-orchestrator
npm run dev
```

**Terminal 4 - Web Frontend**:
```bash
cd apps/web
npm run dev
```

### 5. Access Services

- **Web UI**: http://localhost:3000
- **API Docs**: http://localhost:8000/docs
- **Query Runtime**: http://localhost:3002
- **Agent Orchestrator**: http://localhost:3001
- **Prometheus**: http://localhost:9090
- **Grafana**: http://localhost:3001 (admin/admin)

## Development Workflow

### Adding a New Package

```bash
# Create package directory
mkdir packages/my-package
cd packages/my-package

# Create package.json (see existing packages for template)
# Create src/index.ts, src/types.ts, etc.
# Create tsconfig.json

# Build
npm run build
```

### Adding a New API Endpoint

1. **API Service** (`apps/api/main.py`):
```python
@app.post("/api/v1/my-endpoint")
async def my_endpoint(request: MyRequest) -> MyResponse:
    """
    Endpoint description
    """
    return MyResponse(...)
```

2. **Agent Orchestrator** (`apps/agent-orchestrator/src/main.ts`):
```typescript
app.post('/my-endpoint', async (req: Request, res: Response) => {
  // Implementation
});
```

### Adding an Agent Type

1. **Create agent class** (`packages/agent-core/src/agent.ts`):
```typescript
export class MyAgent extends BaseAgent {
  constructor(tenantId: string) {
    super(tenantId, 'My Agent', 'Description');
  }

  protected async plan(input: Record<string, unknown>): Promise<ExecutionStep[]> {
    // Define execution steps
  }
}
```

2. **Register in orchestrator** (`apps/agent-orchestrator/src/main.ts`):
```typescript
case 'my_agent':
  agent = new MyAgent(tenantId);
  break;
```

### Adding Tests

Create test files alongside source code:

```typescript
// src/my-module.test.ts
import { describe, it, expect } from '@jest/globals';
import { MyClass } from './my-module';

describe('MyClass', () => {
  it('should work correctly', () => {
    const instance = new MyClass();
    expect(instance.method()).toEqual('expected');
  });
});
```

Run tests:
```bash
npm run test
```

## Code Quality

### Linting

```bash
# Lint all packages
npm run lint

# Fix linting issues
npm run format
```

### Type Checking

```bash
# Check types
npm run type-check

# Fix type issues with --allowJs
```

### Building

```bash
# Build everything
npm run build

# Build with turbo (faster)
npm run build -- --parallel
```

## Debugging

### VS Code Launch Configuration

Add to `.vscode/launch.json`:

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "API",
      "type": "python",
      "request": "launch",
      "module": "uvicorn",
      "args": ["main:app", "--reload", "--port", "8000"],
      "cwd": "${workspaceFolder}/apps/api",
      "console": "integratedTerminal"
    },
    {
      "name": "Node Service",
      "type": "node",
      "request": "launch",
      "program": "${workspaceFolder}/apps/agent-orchestrator/dist/main.js",
      "preLaunchTask": "npm: build",
      "cwd": "${workspaceFolder}"
    }
  ]
}
```

### Database Inspection

```bash
# Connect to PostgreSQL
docker exec -it neurostack-postgres psql -U neurostack -d neurostack

# Query
SELECT * FROM metrics;

# Qdrant
curl http://localhost:6333/collections

# Neo4j
# Visit http://localhost:7474 (neo4j/neurostack)
```

## Database Operations

### Migrations

Currently using manual migration approach. Future: implement proper migration framework.

```bash
# Connect to database
docker exec -it neurostack-postgres psql -U neurostack -d neurostack

# Create table
CREATE TABLE metrics (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  name VARCHAR NOT NULL,
  definition JSONB
);
```

## Performance Testing

```bash
# Load test API
npm install -g artillery

artillery run load-test.yml

# Profile query execution
# Query Runtime includes timing in responses
```

## Git Workflow

```bash
# Create feature branch
git checkout -b feature/my-feature

# Make changes and commit
git add .
git commit -m "feat: add feature description"

# Push and create PR
git push origin feature/my-feature
```

## Troubleshooting

### Port Already in Use

```bash
# Find process on port
lsof -i :3000

# Kill process
kill -9 <PID>
```

### Docker Issues

```bash
# Rebuild containers
docker-compose down -v
docker-compose up --build

# View container logs
docker-compose logs api
```

### Dependencies Issues

```bash
# Clean install
npm run clean
npm install
npm run build
```

### Type Errors

```bash
# Regenerate types
npm run type-check

# Fix automatically
npm run format
```

## Useful Commands

```bash
# Watch mode for all packages
npm run dev

# Build specific service
npm run build -- --filter=neurostack-api

# Test specific package
npm run test -- --testPathPattern=semantic

# Format specific file
npx prettier --write packages/shared/src/types.ts

# Clean all
npm run clean

# View available commands
npm run
```

## Environment Variables

Copy `.env.example` to `.env.local`:

```bash
cp apps/web/.env.example apps/web/.env.local
```

Common variables:

```
# API
NEXT_PUBLIC_API_URL=http://localhost:8000/api/v1
DATABASE_URL=postgresql://neurostack:neurostack@localhost:5432/neurostack
REDIS_URL=redis://localhost:6379

# Services
QUERY_RUNTIME_URL=http://localhost:3002
AGENT_ORCHESTRATOR_URL=http://localhost:3001

# AI
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...

# Environment
ENVIRONMENT=development
LOG_LEVEL=debug
```

## Getting Help

- Check [CONTRIBUTING.md](../CONTRIBUTING.md) for standards
- Read [ARCHITECTURE.md](../ARCHITECTURE.md) for system design
- Review existing code patterns in packages/
- Open GitHub issue with details

## Next Steps

After setup:
1. Explore package implementations
2. Review ARCHITECTURE.md
3. Try modifying a simple component
4. Add a test for your changes
5. Submit a PR!
