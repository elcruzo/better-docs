# better-docs -- Comprehensive TODO

## Status Key

- [x] Done
- [ ] Not started
- [~] Partially done

---

## DONE (completed this session)

### Agent: Doc Generation Reliability
- [x] Cap plan prompt at 6-15 pages max (was generating 32 for large repos)
- [x] Hard safety cap of 15 pages even if LLM ignores the prompt instruction
- [x] Budget-aware symbol context for page generation (12k char budget, never slices mid-symbol, prioritizes explicitly named symbols)
- [x] Retry logic on page generation: up to 3 attempts with 1s/2s back-off
- [x] Progress reporting shows succeeded/failed page counts

### Rust Engine: Faster Neo4j Indexing
- [x] Batch IMPORTS_FROM edges with UNWIND (was 1 query per import)
- [x] Batch CALLS edges with UNWIND (was 1 query per caller-callee pair -- N*M queries)
- [x] Batch INHERITS edges with UNWIND (was 1 query per class-base pair)

### Web: DB Persistence (Critical Fix)
- [x] Streaming SSE docs now intercepted and saved to DB via TransformStream
- [x] Non-streaming path already saved (verified)
- [x] Refine path now passes repo_url instead of empty string
- [x] Slug includes userId prefix to prevent cross-user collisions

### Web: History
- [x] History re-fetches after generation completes (streaming + non-streaming + refine)
- [x] "Your Repositories" header is sticky/fixed, list scrolls independently
- [x] "History" header is sticky/fixed, list scrolls independently

### Web: UI Polish
- [x] Active page in DocsSidebar uses brown accent color (matches brand)
- [x] DocsContent sections use consistent gap-6 spacing
- [x] Headings get extra pt-4 top padding for visual separation

---

## PRIORITY 1: Deployment (Vercel + Domain + Wildcard Subdomains)

This is the next block of work. Nothing else starts until this is live.

### Vercel Setup
- [ ] Deploy `web/` to Vercel (set root directory to `web/`)
- [ ] Add env vars on Vercel:
  - `GITHUB_ID`, `GITHUB_SECRET`
  - `NEXTAUTH_SECRET`, `NEXTAUTH_URL=https://better-docs.xyz`
  - `DATABASE_URL` (Postgres -- Vercel Postgres or external)
  - `AGENT_URL` (Railway agent URL, once deployed)
- [ ] Run `npx prisma migrate deploy` on Vercel build or as a post-build step
- [ ] Verify auth flow works on production URL

### Domain + Wildcard DNS
- [ ] Add `better-docs.xyz` as primary domain in Vercel
- [ ] Add `*.better-docs.xyz` as wildcard domain in Vercel
- [ ] Configure DNS:
  - `A` / `CNAME` for `better-docs.xyz` -> Vercel
  - `A` / `CNAME` for `*.better-docs.xyz` -> Vercel
- [ ] Verify both resolve (bare domain + any subdomain)

### Next.js Middleware for Subdomain Routing
- [ ] Create `web/src/middleware.ts`
- [ ] Logic:
  - Extract subdomain from `Host` header (e.g. `myproject.better-docs.xyz` -> `myproject`)
  - If subdomain exists and is not `www` / `app`, rewrite request to `/docs/[project]`
  - If bare domain (`better-docs.xyz`), pass through to dashboard
- [ ] Handle `localhost` for local dev (check for port-based routing or skip subdomain logic)

### Public Docs Page (Standalone Rendering)
- [ ] Create `web/src/app/docs/[project]/page.tsx`
  - Server-side: call `getDocs(slug)` from storage
  - Render full standalone docs page using `DocsSidebar` + `DocsContent`
  - No auth required -- this is the public-facing page
- [ ] Create `web/src/app/docs/[project]/layout.tsx`
  - Standalone layout (NO dashboard chrome, NO navbar, NO left sidebar)
  - Just the doc viewer: sidebar nav + content + minimap
  - Include theme support (light/dark toggle)
  - Add a small "Powered by better-docs" footer/badge with link back to `better-docs.xyz`
- [ ] Handle 404 gracefully if slug doesn't exist
- [ ] Add meta tags / OpenGraph for social sharing (title, description from generated docs)

### Update next.config.js
- [ ] Add any necessary config for subdomain support
- [ ] Ensure `output: "standalone"` is still set for Vercel

---

## PRIORITY 2: CLI Tool (pip installable)

A Python CLI that anyone can install and use to generate docs from their terminal. Uses natural language input.

### Package Setup
- [ ] Create `cli/` directory at project root
- [ ] `cli/setup.py` or `cli/pyproject.toml` with:
  - Package name: `better-docs`
  - Entry point: `better-docs` command (console_scripts)
  - Dependencies: `click`, `rich`, `httpx`, `questionary`
- [ ] `cli/better_docs/__init__.py`
- [ ] `cli/better_docs/main.py` -- entry point
- [ ] `cli/better_docs/commands/` -- subcommands
- [ ] `cli/README.md` -- usage docs

### Core CLI Behavior
- [ ] `better-docs` with no args -- detect current repo, ask what kind of docs, generate
- [ ] `better-docs generate` -- explicit generate command
- [ ] `better-docs deploy` -- generate + deploy to `{repo}.better-docs.xyz`
- [ ] Natural language support: `better-docs "generate API docs for this repo"` -- parse intent
- [ ] `better-docs login` -- authenticate via GitHub OAuth device flow
- [ ] `better-docs status` -- show current project's deployed docs URL

### GitHub CLI Dependency
- [ ] On first run, check if `gh` (GitHub CLI) is installed (`which gh` / `shutil.which`)
- [ ] If not installed, print instructions:
  - macOS: `brew install gh`
  - Linux: link to https://cli.github.com
  - Windows: `winget install GitHub.cli`
- [ ] Ask user if they want to install it now (run brew/apt for them if they confirm)
- [ ] Check if `gh auth status` shows logged in; if not, prompt `gh auth login`
- [ ] Use `gh` for repo detection: `gh repo view --json url,name,owner`

### API Integration
- [ ] CLI posts to `https://better-docs.xyz/api/generate` (production) or `--local` flag for localhost
- [ ] Stream progress via SSE -- show progress bar with `rich`
- [ ] On completion, print the deployed URL: `https://{slug}.better-docs.xyz`
- [ ] Cache auth token in `~/.config/better-docs/config.json`

### pip / Installation
- [ ] Publish to PyPI as `better-docs`
- [ ] Users install with: `pip install better-docs`
- [ ] Or one-shot: `pipx install better-docs`
- [ ] Ensure `better-docs` is available on PATH after install (console_scripts entry point)
- [ ] Shell completion support (click has built-in support for bash/zsh/fish)

---

## PRIORITY 3: Railway Deployment (Backend)

### Railway Config
- [ ] Create `railway.toml` at project root with two services:
  - **engine** -- Rust binary, port 3001, builds from root Dockerfile
  - **agent** -- Python FastAPI, port 8000, builds from agent/Dockerfile
- [ ] Set env vars per service on Railway:
  - Engine: `NEO4J_URI`, `NEO4J_USER`, `NEO4J_PASSWORD`
  - Agent: `AWS_BEDROCK` creds or `ANTHROPIC_API_KEY`, `ENGINE_URL` (internal Railway URL), `NEO4J_*`
- [ ] Deploy and verify both services are healthy
- [ ] Get the agent's public URL and set as `AGENT_URL` in Vercel env

### Neo4j Production
- [ ] Set up Neo4j Aura Free (or Railway Neo4j plugin)
- [ ] Get connection URI, user, password
- [ ] Test engine can connect and create schema

### Docker Compose (Local Dev)
- [ ] Update `docker-compose.yml` with all services:
  - `engine` (Rust, port 3001)
  - `agent` (Python, port 8000)
  - `neo4j` (Neo4j 5, ports 7474/7687)
  - `web` (Next.js, port 3000)
  - `postgres` (for Prisma, port 5432)
- [ ] Shared network so services can reach each other
- [ ] Volume mounts for Neo4j and Postgres data persistence
- [ ] `.env.docker` with all required env vars pre-filled for local dev

---

## PRIORITY 4: GitHub Webhook / Auto-Update

### Webhook Endpoint
- [ ] Create `web/src/app/api/webhook/route.ts`
- [ ] Accept GitHub `push` events
- [ ] Verify webhook signature (HMAC)
- [ ] On push to default branch: re-run pipeline for that repo
- [ ] Update stored docs in DB
- [ ] Deployed subdomain automatically shows latest

### Dashboard Webhook Registration
- [ ] After generating docs from dashboard, offer to "auto-update on push"
- [ ] Use GitHub API (user's OAuth token) to register a webhook on their repo
- [ ] Store webhook ID in Project model for cleanup
- [ ] UI toggle to enable/disable auto-updates

### GitHub Action Template
- [ ] Create `.github/workflows/better-docs.yml` template
- [ ] Triggers on push to main
- [ ] Runs `pip install better-docs && better-docs deploy`
- [ ] Users copy this into their repo for CI-based auto-update

---

## PRIORITY 5: Polish & Features

### Interactive Docs Editor
- [ ] Click-to-edit sections in the dashboard
- [ ] Save edits back to docs JSON
- [ ] "Publish" button pushes changes to deployed subdomain

### Analytics
- [ ] Track page views per deployed doc site
- [ ] Show view counts in dashboard history

### Custom Domains
- [ ] Let users add their own custom domain (e.g. `docs.mycompany.com`)
- [ ] Vercel API to add domain programmatically
- [ ] DNS verification flow in dashboard

### Search
- [ ] Full-text search within generated docs
- [ ] Cmd+K search bar on public doc pages

### Versioning
- [ ] Keep multiple versions of docs per project
- [ ] Version selector dropdown on public doc page
- [ ] Diff view between versions

---

## Architecture Reference

```
YC-Hackathon/
  src/              # Rust engine (tree-sitter parser + Neo4j)
  agent/            # Python agent (LangGraph + Claude, FastAPI)
  web/              # Next.js frontend (dashboard + public docs)
  cli/              # Python CLI (pip install better-docs) [TO CREATE]
  docker-compose.yml
  railway.toml      [TO CREATE]
```

### Services (Production)

| Service | Host | Tech |
|---------|------|------|
| Frontend + Public Docs | Vercel (`better-docs.xyz` + `*.better-docs.xyz`) | Next.js |
| Agent API | Railway | Python / FastAPI / LangGraph |
| Engine API | Railway | Rust / Axum / tree-sitter |
| Code Graph | Neo4j Aura | Neo4j 5 |
| App Database | Vercel Postgres (or external) | PostgreSQL / Prisma |

### Data Flow

```
User (dashboard or CLI)
  -> POST /api/generate (Vercel)
    -> POST /generate/stream (Railway agent)
      -> POST /index (Railway engine -> Neo4j)
      -> POST /classify (Railway engine -> Neo4j)
      -> POST /graph/query (Railway engine -> Neo4j)
      -> LLM: plan docs (Claude)
      -> LLM: generate pages (Claude, 5 concurrent)
    <- SSE stream back to client
    -> saveDocs() to Postgres
  -> Docs visible at {slug}.better-docs.xyz via middleware rewrite
```
