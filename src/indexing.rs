use ignore::WalkBuilder;
use rayon::prelude::*;
use std::sync::Arc;
use std::path::Path;
use serde::{Deserialize, Serialize};
use crate::graph::GraphClient;
use crate::parsing;

#[derive(Debug, Serialize, Deserialize, Default)]
pub struct IndexingStats {
    pub files_processed: usize,
    pub files_skipped: usize,
    pub nodes_created: usize,
}

pub async fn index_repository(repo_path: &str, repo_name: &str, graph: Option<Arc<GraphClient>>) -> IndexingStats {
    let files: Vec<_> = WalkBuilder::new(repo_path)
        .hidden(false)
        .git_ignore(true)
        .build()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().map(|ft| ft.is_file()).unwrap_or(false))
        .map(|e| e.path().to_owned())
        .collect();

    let parsed: Vec<_> = files.par_iter()
        .filter_map(|path| {
            let s = path.to_str()?;
            if parsing::detect_language(s) == parsing::Language::Unknown { return None; }
            let content = std::fs::read_to_string(path).ok()?;
            Some((s.to_string(), parsing::parse_content(s, &content)))
        })
        .collect();

    let mut stats = IndexingStats {
        files_processed: parsed.len(),
        files_skipped: files.len() - parsed.len(),
        ..Default::default()
    };

    if let Some(client) = graph {
        for (path, result) in &parsed {
            let rel = Path::new(path).strip_prefix(repo_path).unwrap_or(Path::new(path));
            let rel_str = rel.to_str().unwrap_or(path);
            if client.ingest_symbols(repo_name, rel_str, result).await.is_ok() {
                stats.nodes_created += result.symbols.len() + 1;
            }
        }
    }

    stats
}
