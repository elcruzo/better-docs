# better-docs

Instant documentation from any codebase. Point at a GitHub repo, get a live docs site.

## Setup

### 1. Start Neo4j

```bash
docker-compose up -d
```

### 2. Fill in env vars

```bash
# agent/.env
ANTHROPIC_API_KEY=sk-ant-...
NEO4J_URI=bolt://localhost:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=betterdocs
ENGINE_URL=http://localhost:3001

# web/.env.local
GITHUB_ID=...
GITHUB_SECRET=...
NEXTAUTH_SECRET=...
NEXTAUTH_URL=http://localhost:3000
AGENT_URL=http://localhost:8000
```

### 3. Run services (3 terminals)

**Rust engine** (port 3001):
```bash
cargo run
```

**Python agent** (port 8000):
```bash
cd agent
pip install -r requirements.txt
uvicorn app.main:app --port 8000
```

**Next.js web** (port 3000):
```bash
cd web
pnpm install
pnpm dev
```

## Architecture

- **Rust engine** (3001): tree-sitter parser (8 languages), Neo4j graph, codebase classifier
- **LangGraph agent** (8000): clone -> parse -> classify -> Claude generates docs
- **Next.js dashboard** (3000): GitHub OAuth, repo picker, doc type selector, Mintlify-style docs preview, prompt bar
