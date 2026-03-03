# Contributing to better-docs

Thanks for your interest in contributing. This guide covers the workflow, code standards, and how to get a PR merged.

## Getting started

1. Fork the repository and clone your fork.
2. Follow the [local development setup](README.md#local-development) in the README.
3. Create a feature branch from `main`:
   ```bash
   git checkout -b your-feature-name
   ```

## Development workflow

1. Make your changes in a feature branch.
2. Test locally — ensure all three services (engine, agent, web) still work together.
3. Commit with a clear, concise message describing *why* the change was made.
4. Push to your fork and open a pull request against `main`.

## Code style

### Rust (engine)

- Format with `cargo fmt` before committing.
- Run `cargo clippy` and fix any warnings.
- Prefer `thiserror` for custom error types over manual `impl`.
- Use `tracing` macros (`info!`, `error!`, etc.) for logging — not `println!`.

### Python (agent)

- Target Python 3.12+.
- Format with `ruff format` or `black`.
- Lint with `ruff check`.
- Use type hints on all function signatures.
- Use `async`/`await` for all I/O — no blocking calls on the event loop.

### TypeScript (web)

- Format with Prettier (the project's default config).
- Use the App Router conventions (server components by default, `"use client"` only when needed).
- Avoid `any` — use proper types from `@/types`.

## Commit messages

Write commit messages in imperative mood. Keep the subject line under 72 characters. Add a body if the *why* isn't obvious from the subject.

```
Add concurrent Neo4j ingestion in indexing pipeline

Replaces sequential per-file ingestion with buffer_unordered(32)
to reduce total indexing time by ~4x for large repos.
```

## Pull requests

- One logical change per PR. Don't bundle unrelated fixes.
- Reference any related issues in the PR description.
- Include a brief test plan — what did you run to verify this works?
- PRs require at least one review before merge.
- Force-pushing to `main` is blocked. Use squash or merge commits.

## Reporting bugs

Open an issue with:
- What you expected to happen.
- What actually happened (include logs or screenshots).
- Steps to reproduce.
- Your environment (OS, Node/Rust/Python versions).

## Architecture decisions

If your change touches the service boundary (how engine, agent, and web communicate), or introduces a new dependency, open an issue first to discuss the approach before writing code.

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
