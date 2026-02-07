use neo4rs::*;
use std::sync::Arc;
use serde_json::{json, Value};
use crate::parsing::ParsingResult;

pub struct GraphClient {
    graph: Arc<Graph>,
}

impl GraphClient {
    pub async fn connect(uri: &str, user: &str, pass: &str) -> Result<Self> {
        let graph = Graph::new(uri, user, pass).await?;
        Ok(Self { graph: Arc::new(graph) })
    }

    pub async fn ensure_schema(&self) -> Result<()> {
        for q in [
            "CREATE CONSTRAINT IF NOT EXISTS FOR (f:File) REQUIRE f.id IS UNIQUE",
            "CREATE CONSTRAINT IF NOT EXISTS FOR (c:Class) REQUIRE c.id IS UNIQUE",
            "CREATE CONSTRAINT IF NOT EXISTS FOR (fn:Function) REQUIRE fn.id IS UNIQUE",
            "CREATE INDEX IF NOT EXISTS FOR (n:Node) ON (n.name)",
        ] {
            self.graph.run(query(q)).await?;
        }
        Ok(())
    }

    pub async fn ingest_symbols(&self, repo_name: &str, file_path: &str, result: &ParsingResult) -> Result<()> {
        let file_id = format!("{}::{}", repo_name, file_path);
        self.graph.run(
            query("MERGE (f:File {id: $id}) SET f.path = $path, f.repo = $repo, f.language = $lang")
                .param("id", file_id.clone())
                .param("path", file_path)
                .param("repo", repo_name)
                .param("lang", format!("{:?}", result.language))
        ).await?;

        for imp in &result.imports {
            self.graph.run(
                query("MERGE (f:File {id: $fid}) SET f.imports = coalesce(f.imports, []) + $imp")
                    .param("fid", file_id.clone())
                    .param("imp", imp.clone())
            ).await?;
        }

        for symbol in &result.symbols {
            let label = match symbol.kind.as_str() {
                "class" => "Class",
                "function" | "method" => "Function",
                _ => "Symbol",
            };
            let symbol_id = format!("{}::{}", file_id, symbol.name);
            let create = format!("MERGE (s:{} {{id: $id}}) SET s.name = $name, s.kind = $kind, s.preview = $preview, s.docstring = $doc, s.signature = $sig, s.line_start = $ls, s.line_end = $le", label);
            self.graph.run(
                query(&create)
                    .param("id", symbol_id.clone())
                    .param("name", symbol.name.clone())
                    .param("kind", symbol.kind.clone())
                    .param("preview", symbol.content_preview.clone())
                    .param("doc", symbol.docstring.clone().unwrap_or_default())
                    .param("sig", symbol.signature.clone().unwrap_or_default())
                    .param("ls", symbol.range.0 as i64)
                    .param("le", symbol.range.1 as i64)
            ).await?;

            self.graph.run(
                query("MATCH (f:File {id: $fid}) MATCH (s {id: $sid}) MERGE (f)-[:CONTAINS]->(s)")
                    .param("fid", file_id.clone())
                    .param("sid", symbol_id)
            ).await?;
        }
        Ok(())
    }

    pub async fn get_all_symbols(&self, repo_name: &str) -> Result<Vec<Value>> {
        let mut result = self.graph.execute(
            query("MATCH (f:File {repo: $repo})-[:CONTAINS]->(s) RETURN s.name AS name, s.kind AS kind, s.docstring AS doc, s.signature AS sig, f.path AS file, s.line_start AS ls, s.line_end AS le")
                .param("repo", repo_name)
        ).await?;
        let mut out = vec![];
        while let Some(row) = result.next().await? {
            out.push(json!({
                "name": row.get::<String>("name").unwrap_or_default(),
                "kind": row.get::<String>("kind").unwrap_or_default(),
                "docstring": row.get::<String>("doc").unwrap_or_default(),
                "signature": row.get::<String>("sig").unwrap_or_default(),
                "file": row.get::<String>("file").unwrap_or_default(),
                "line_start": row.get::<i64>("ls").unwrap_or(0),
                "line_end": row.get::<i64>("le").unwrap_or(0),
            }));
        }
        Ok(out)
    }

    pub async fn get_all_files(&self, repo_name: &str) -> Result<Vec<Value>> {
        let mut result = self.graph.execute(
            query("MATCH (f:File {repo: $repo}) RETURN f.path AS path, f.language AS lang")
                .param("repo", repo_name)
        ).await?;
        let mut out = vec![];
        while let Some(row) = result.next().await? {
            out.push(json!({
                "path": row.get::<String>("path").unwrap_or_default(),
                "language": row.get::<String>("lang").unwrap_or_default(),
            }));
        }
        Ok(out)
    }

    pub async fn get_repo_structure(&self, repo_name: &str) -> Result<Vec<Value>> {
        let mut result = self.graph.execute(
            query("MATCH (f:File {repo: $repo}) OPTIONAL MATCH (f)-[:CONTAINS]->(s) RETURN f.path AS path, f.language AS lang, collect({name: s.name, kind: s.kind, sig: s.signature, doc: s.docstring}) AS symbols")
                .param("repo", repo_name)
        ).await?;
        let mut out = vec![];
        while let Some(row) = result.next().await? {
            out.push(json!({
                "path": row.get::<String>("path").unwrap_or_default(),
                "language": row.get::<String>("lang").unwrap_or_default(),
                "symbols": row.get::<Vec<Value>>("symbols").unwrap_or_default(),
            }));
        }
        Ok(out)
    }

    pub async fn count_by_kind(&self, repo_name: &str) -> Result<Value> {
        let mut result = self.graph.execute(
            query("MATCH (f:File {repo: $repo})-[:CONTAINS]->(s) RETURN s.kind AS kind, count(s) AS cnt")
                .param("repo", repo_name)
        ).await?;
        let mut counts = serde_json::Map::new();
        while let Some(row) = result.next().await? {
            let kind = row.get::<String>("kind").unwrap_or_default();
            let cnt = row.get::<i64>("cnt").unwrap_or(0);
            counts.insert(kind, json!(cnt));
        }
        Ok(Value::Object(counts))
    }

    pub async fn get_file_languages(&self, repo_name: &str) -> Result<Value> {
        let mut result = self.graph.execute(
            query("MATCH (f:File {repo: $repo}) RETURN f.language AS lang, count(f) AS cnt")
                .param("repo", repo_name)
        ).await?;
        let mut langs = serde_json::Map::new();
        while let Some(row) = result.next().await? {
            let lang = row.get::<String>("lang").unwrap_or_default();
            let cnt = row.get::<i64>("cnt").unwrap_or(0);
            langs.insert(lang, json!(cnt));
        }
        Ok(Value::Object(langs))
    }
}
