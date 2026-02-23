use futures::stream::{self, StreamExt};
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
    let repo_path_owned = repo_path.to_string();

    // Offload blocking rayon + fs work to a dedicated thread so we don't starve the tokio runtime
    let parsed = tokio::task::spawn_blocking(move || {
        let files: Vec<_> = WalkBuilder::new(&repo_path_owned)
            .hidden(false)
            .git_ignore(true)
            .build()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_type().map(|ft| ft.is_file()).unwrap_or(false))
            .filter(|e| {
                e.path().to_str()
                    .map(|s| parsing::detect_language(s) != parsing::Language::Unknown)
                    .unwrap_or(false)
            })
            .map(|e| e.path().to_owned())
            .collect();

        let total_files = files.len();
        let parsed: Vec<_> = files.par_iter()
            .filter_map(|path| {
                let s = path.to_str()?;
                let content = std::fs::read_to_string(path).ok()?;
                Some((s.to_string(), parsing::parse_content(s, &content)))
            })
            .collect();

        (parsed, total_files)
    }).await.unwrap_or_default();

    let (parsed, total_walked) = parsed;

    let mut stats = IndexingStats {
        files_processed: parsed.len(),
        files_skipped: total_walked - parsed.len(),
        ..Default::default()
    };

    if let Some(client) = graph {
        let repo_name_arc: Arc<str> = repo_name.into();

        // Ingest files concurrently (up to 32 at a time) instead of sequentially
        let results: Vec<usize> = stream::iter(parsed.into_iter())
            .map(|(path, result)| {
                let client = client.clone();
                let rn = repo_name_arc.clone();
                let rel = Path::new(&path).strip_prefix(repo_path).unwrap_or(Path::new(&path))
                    .to_str().unwrap_or(&path).to_string();
                let sym_count = result.symbols.len() + 1;
                async move {
                    if client.ingest_symbols(&rn, &rel, &result).await.is_ok() {
                        sym_count
                    } else {
                        0
                    }
                }
            })
            .buffer_unordered(32)
            .collect()
            .await;

        stats.nodes_created = results.iter().sum();
    }

    stats
}
