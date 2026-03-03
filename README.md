# better-docs

AI-powered documentation generation from any codebase. Point at a GitHub repo, get a live docs site at `<your-repo>.better-docs.xyz`.

better-docs clones your repository, parses every file into a code knowledge graph, classifies what kind of project it is, and uses Claude to generate structured, multi-page documentation — streamed to you page-by-page as it's written.

## How it works

1. **Clone** — shallow clone of the target repo (private repos supported via OAuth token injection)
2. **Parse** — every text file is sent to a Rust engine that extracts symbols, signatures, call graphs, imports, and inheritance using tree-sitter
3. **Index** — parsed symbols are ingested into a Neo4j graph with `File → Symbol` relationships (`CONTAINS`, `IMPORTS_FROM`, `CALLS`, `INHERITS`)
4. **Classify** — heuristic analysis of symbol counts, language mix, and file paths determines doc type (consumer docs, API reference, library docs, CLI docs)
5. **Structure** — the full code graph is queried to build a complete map of files and symbols
6. **Generate** — two-phase LLM pipeline: first plans the doc outline from the full file tree, then generates each page concurrently (5 at a time) with relevant symbol context
7. **Stream** — each page is streamed to the frontend via SSE as it completes, so you can start reading while the rest generates

## Architecture

Three services, each independently deployable:

```
┌─────────────────────────────────────────────────────────────────────┐
│  Next.js Web  ·  port 3000                                          │
│                                                                     │
│  Dashboard: repo picker, doc type selector, SSE generation,         │
│  incremental page preview, natural language refinement              │
│                                                                     │
│  Public docs: *.better-docs.xyz → middleware rewrite → SSR page     │
│  Auth: NextAuth + GitHub OAuth    DB: PostgreSQL via Prisma         │
└──────────────┬──────────────────────────────────────────────────────┘
               │  HTTP (SSE streaming)
┌──────────────▼──────────────────────────────────────────────────────┐
│  Python Agent  ·  port 8000                                         │
│                                                                     │
│  FastAPI + LangGraph StateGraph                                     │
│  LLM: Claude (Anthropic API or AWS Bedrock)                         │
│                                                                     │
│  Pipeline:  clone ─► parse ─┬─► classify ─┬─► generate              │
│                             └─► structure ─┘                        │
│                                                                     │
│  classify + structure run concurrently after parse                  │
│  generate streams individual pages back via SSE as each completes   │
└──────────────┬──────────────────────────────────────────────────────┘
               │  HTTP (concurrent requests)
┌──────────────▼──────────────────────────────────────────────────────┐
│  Rust Engine  ·  port 3001                                          │
│                                                                     │
│  Axum HTTP server                                                   │
│  tree-sitter parsing: 9 grammars (Python, TypeScript, JavaScript,   │
│    Rust, Go, Java, C++, Ruby, PHP) + any text file as a file node   │
│  Parallel file walking with Rayon, .gitignore-aware (ignore crate)  │
│  Concurrent Neo4j ingestion: buffer_unordered(32) via futures       │
│  Batched Cypher queries: UNWIND for bulk UPSERT of edges            │
└──────────────┬──────────────────────────────────────────────────────┘
               │  Bolt protocol
┌──────────────▼──────────────────────────────────────────────────────┐
│  Neo4j 5                                                            │
│                                                                     │
│  Code knowledge graph                                               │
│  Nodes: File, Function, Class, Struct, Trait, Interface, Enum, ...  │
│  Edges: CONTAINS, IMPORTS_FROM, CALLS, INHERITS                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Tech stack

| Layer | Technology |
|---|---|
| **Engine** | Rust, Axum 0.7, tree-sitter, neo4rs 0.8, Rayon, Tokio |
| **Agent** | Python 3.12, FastAPI, LangGraph, langchain-anthropic, httpx |
| **Web** | Next.js 14 (App Router), NextAuth, Prisma 6, Tailwind CSS |
| **Graph DB** | Neo4j 5 Community |
| **App DB** | PostgreSQL |
| **Deployment** | Vercel (web), Railway (engine + agent + neo4j) |

### Key design decisions

**Graph-based code understanding** — Rather than dumping raw source into an LLM prompt, the engine builds a typed graph of symbols and relationships. This lets the agent query exactly the context each doc page needs, staying within token budgets while covering the entire codebase.

**Two-phase generation** — Phase 1 sends the complete file tree + symbol names (compact) to the LLM to plan which pages to create and what each covers. Phase 2 generates each page independently with only its relevant symbols as context. This scales to large codebases without blowing context windows.

**Incremental streaming** — The plan skeleton (title, nav structure) is emitted first so the UI can render the sidebar immediately. Then each page streams in as it completes. The user starts reading page 1 while pages 2–9 are still generating.

**Universal file support** — The agent sends every text file to the engine, not just files in supported languages. tree-sitter handles 9 languages with full symbol extraction; other text files are indexed as file nodes so the LLM still has their content as context.

**Concurrent everything** — File parsing uses Rayon thread pools. Neo4j ingestion runs 32 at a time via `buffer_unordered`. The agent fires 20 concurrent parse requests. Classify and structure run in parallel. Page generation runs 5 concurrent LLM calls. Nothing waits in line.

## Project structure

```
├── src/                    Rust engine
│   ├── main.rs             Axum server, routes, app state
│   ├── parsing.rs          tree-sitter multi-language parser
│   ├── graph.rs            Neo4j client (batched UPSERT, queries)
│   ├── classifier.rs       Doc type classification heuristics
│   └── indexing.rs         Repo walker, parallel parse, concurrent ingest
├── agent/                  Python agent
│   ├── app/
│   │   ├── main.py         FastAPI app, SSE endpoint
│   │   ├── pipeline.py     LangGraph StateGraph, streaming runner
│   │   ├── models.py       Pydantic request/response models
│   │   ├── llm.py          LLM provider config (Anthropic / Bedrock)
│   │   └── nodes/
│   │       ├── clone.py    Async git clone (private repo support)
│   │       ├── parse.py    File collection, engine HTTP calls
│   │       ├── generate.py Two-phase LLM doc generation
│   │       └── refine.py   LLM-powered doc refinement
│   ├── requirements.txt
│   └── Dockerfile
├── web/                    Next.js frontend
│   ├── src/
│   │   ├── app/
│   │   │   ├── dashboard/  Repo picker, generation, preview
│   │   │   ├── docs/[slug] Public docs viewer (SSR, ISR 60s)
│   │   │   ├── login/      GitHub OAuth sign-in
│   │   │   └── api/        API routes
│   │   ├── components/     DocsPreview, DocsSidebar, DocsContent, ...
│   │   ├── lib/            Agent client, auth config, storage, prisma
│   │   └── middleware.ts   Wildcard subdomain routing
│   ├── prisma/schema.prisma
│   └── Dockerfile
├── Cargo.toml
├── docker-compose.yml      Local dev (Neo4j)
└── railway.toml            Railway deployment config
```

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

[MIT](LICENSE)
