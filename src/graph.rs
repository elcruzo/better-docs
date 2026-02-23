use neo4rs::*;
use std::collections::HashMap;
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

        // Collect raw import strings
        let import_raws: Vec<String> = result.imports.iter().map(|i| i.raw.clone()).collect();
        let export_list: Vec<String> = result.exports.clone();

        // Upsert file node
        self.graph.run(
            query("MERGE (f:File {id: $id}) SET f.path = $path, f.repo = $repo, f.language = $lang, f.imports = $imports, f.exports = $exports")
                .param("id", file_id.clone())
                .param("path", file_path)
                .param("repo", repo_name)
                .param("lang", format!("{:?}", result.language))
                .param("imports", import_raws)
                .param("exports", export_list)
        ).await?;

        // Batch IMPORTS_FROM edges via UNWIND
        let import_batch: Vec<HashMap<String, BoltType>> = result.imports.iter()
            .filter_map(|imp| {
                let source = imp.source.as_ref()?;
                let source_clean = source.replace('.', "/");
                let mut m: HashMap<String, BoltType> = HashMap::new();
                m.insert("mod_name".into(), source_clean.into());
                m.insert("names".into(), imp.names.clone().into());
                Some(m)
            })
            .collect();

        if !import_batch.is_empty() {
            self.graph.run(
                query("UNWIND $batch AS imp \
                       MATCH (f:File {id: $fid}) \
                       MERGE (m:Module {name: imp.mod_name, repo: $repo}) \
                       MERGE (f)-[:IMPORTS_FROM {names: imp.names}]->(m)")
                    .param("batch", import_batch)
                    .param("fid", file_id.clone())
                    .param("repo", repo_name)
            ).await?;
        }

        if result.symbols.is_empty() {
            return Ok(());
        }

        // Batch all symbols via UNWIND
        for label in &["Class", "Function", "Symbol"] {
            let batch: Vec<HashMap<String, BoltType>> = result.symbols.iter()
                .filter(|s| {
                    let l = match s.kind.as_str() {
                        "class" => "Class",
                        "function" | "method" => "Function",
                        _ => "Symbol",
                    };
                    l == *label
                })
                .map(|s| {
                    let params_json = serde_json::to_string(&s.params).unwrap_or_default();
                    let mut m: HashMap<String, BoltType> = HashMap::new();
                    m.insert("id".into(), format!("{}::{}:{}", file_id, s.name, s.range.0).into());
                    m.insert("name".into(), s.name.clone().into());
                    m.insert("kind".into(), s.kind.clone().into());
                    m.insert("preview".into(), s.content_preview.clone().into());
                    m.insert("doc".into(), s.docstring.clone().unwrap_or_default().into());
                    m.insert("sig".into(), s.signature.clone().unwrap_or_default().into());
                    m.insert("ret".into(), s.return_type.clone().unwrap_or_default().into());
                    m.insert("vis".into(), s.visibility.clone().unwrap_or_default().into());
                    m.insert("parent".into(), s.parent_class.clone().unwrap_or_default().into());
                    m.insert("params".into(), params_json.into());
                    m.insert("decos".into(), s.decorators.join(", ").into());
                    m.insert("ls".into(), (s.range.0 as i64).into());
                    m.insert("le".into(), (s.range.1 as i64).into());
                    m
                })
                .collect();

            if batch.is_empty() { continue; }

            let cypher = format!(
                "UNWIND $batch AS s \
                 MERGE (n:{} {{id: s.id}}) \
                 SET n.name = s.name, n.kind = s.kind, n.preview = s.preview, \
                     n.docstring = s.doc, n.signature = s.sig, \
                     n.return_type = s.ret, n.visibility = s.vis, \
                     n.parent_class = s.parent, n.params = s.params, \
                     n.decorators = s.decos, \
                     n.line_start = s.ls, n.line_end = s.le \
                 WITH n, s \
                 MATCH (f:File {{id: $fid}}) \
                 MERGE (f)-[:CONTAINS]->(n)",
                label
            );
            self.graph.run(
                query(&cypher)
                    .param("batch", batch)
                    .param("fid", file_id.clone())
            ).await?;
        }

        // Batch CALLS edges via UNWIND
        let calls_batch: Vec<HashMap<String, BoltType>> = result.symbols.iter()
            .flat_map(|sym| {
                let caller_id = format!("{}::{}:{}", file_id, sym.name, sym.range.0);
                sym.calls.iter().map(move |callee_name| {
                    let mut m: HashMap<String, BoltType> = HashMap::new();
                    m.insert("cid".into(), caller_id.clone().into());
                    m.insert("name".into(), callee_name.clone().into());
                    m
                })
            })
            .collect();

        if !calls_batch.is_empty() {
            self.graph.run(
                query("UNWIND $batch AS c \
                       MATCH (caller:Function {id: c.cid}) \
                       MATCH (callee:Function {name: c.name})<-[:CONTAINS]-(f:File {repo: $repo}) \
                       MERGE (caller)-[:CALLS]->(callee)")
                    .param("batch", calls_batch)
                    .param("repo", repo_name)
            ).await?;
        }

        // Batch INHERITS edges via UNWIND
        let inherits_batch: Vec<HashMap<String, BoltType>> = result.symbols.iter()
            .filter(|sym| sym.kind == "class" && !sym.bases.is_empty())
            .flat_map(|sym| {
                let child_id = format!("{}::{}:{}", file_id, sym.name, sym.range.0);
                sym.bases.iter().map(move |base| {
                    let mut m: HashMap<String, BoltType> = HashMap::new();
                    m.insert("cid".into(), child_id.clone().into());
                    m.insert("name".into(), base.clone().into());
                    m
                })
            })
            .collect();

        if !inherits_batch.is_empty() {
            self.graph.run(
                query("UNWIND $batch AS c \
                       MATCH (child:Class {id: c.cid}) \
                       MATCH (parent:Class {name: c.name})<-[:CONTAINS]-(f:File {repo: $repo}) \
                       MERGE (child)-[:INHERITS]->(parent)")
                    .param("batch", inherits_batch)
                    .param("repo", repo_name)
            ).await?;
        }

        Ok(())
    }

    pub async fn get_all_symbols(&self, repo_name: &str) -> Result<Vec<Value>> {
        let mut result = self.graph.execute(
            query("MATCH (f:File {repo: $repo})-[:CONTAINS]->(s) RETURN s.name AS name, s.kind AS kind, s.docstring AS doc, s.signature AS sig, s.return_type AS ret, s.visibility AS vis, s.parent_class AS parent, s.params AS params, s.decorators AS decos, f.path AS file, s.line_start AS ls, s.line_end AS le")
                .param("repo", repo_name)
        ).await?;
        let mut out = vec![];
        while let Some(row) = result.next().await? {
            out.push(json!({
                "name": row.get::<String>("name").unwrap_or_default(),
                "kind": row.get::<String>("kind").unwrap_or_default(),
                "docstring": row.get::<String>("doc").unwrap_or_default(),
                "signature": row.get::<String>("sig").unwrap_or_default(),
                "return_type": row.get::<String>("ret").unwrap_or_default(),
                "visibility": row.get::<String>("vis").unwrap_or_default(),
                "parent_class": row.get::<String>("parent").unwrap_or_default(),
                "params": row.get::<String>("params").unwrap_or_default(),
                "decorators": row.get::<String>("decos").unwrap_or_default(),
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
            query("MATCH (f:File {repo: $repo}) OPTIONAL MATCH (f)-[:CONTAINS]->(s) RETURN f.path AS path, f.language AS lang, collect({name: s.name, kind: s.kind, sig: s.signature, doc: s.docstring, ret: s.return_type, vis: s.visibility, parent: s.parent_class, params: s.params, decos: s.decorators}) AS symbols")
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
