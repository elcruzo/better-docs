use serde::{Deserialize, Serialize};
use crate::graph::GraphClient;

#[derive(Debug, Serialize, Deserialize)]
pub struct ClassificationResult {
    pub doc_type: String,
    pub confidence: f64,
    pub signals: Vec<String>,
}

pub async fn classify(client: &GraphClient, repo_name: &str) -> ClassificationResult {
    let mut signals = vec![];
    let mut consumer_score: f64 = 0.0;
    let mut devdocs_score: f64 = 0.0;

    if let Ok(counts) = client.count_by_kind(repo_name).await {
        if let Some(obj) = counts.as_object() {
            let funcs = obj.get("function").and_then(|v| v.as_i64()).unwrap_or(0);
            let classes = obj.get("class").and_then(|v| v.as_i64()).unwrap_or(0);
            let methods = obj.get("method").and_then(|v| v.as_i64()).unwrap_or(0);

            if methods > funcs {
                signals.push("more methods than functions -> likely OOP/API".into());
                devdocs_score += 1.0;
            }
            if classes > 5 {
                signals.push(format!("{} classes detected -> structured codebase", classes));
                devdocs_score += 0.5;
            }
            if funcs > 20 {
                signals.push(format!("{} functions -> large API surface", funcs));
                devdocs_score += 0.5;
            }
        }
    }

    if let Ok(langs) = client.get_file_languages(repo_name).await {
        if let Some(obj) = langs.as_object() {
            let has_python = obj.contains_key("Python");
            let has_js = obj.contains_key("JavaScript") || obj.contains_key("TypeScript");
            let has_cpp = obj.contains_key("Cpp");

            if has_python {
                signals.push("Python detected -> check for FastAPI/Flask routes".into());
                devdocs_score += 0.5;
            }
            if has_js {
                signals.push("JS/TS detected -> check for React components".into());
                consumer_score += 0.5;
            }
            if has_cpp {
                signals.push("C++ detected -> likely library/system docs".into());
                devdocs_score += 1.0;
            }
        }
    }

    if let Ok(files) = client.get_all_files(repo_name).await {
        let paths: Vec<String> = files.iter()
            .filter_map(|f| f.get("path").and_then(|p| p.as_str()).map(|s| s.to_lowercase()))
            .collect();

        let has_routes = paths.iter().any(|p| p.contains("route") || p.contains("endpoint") || p.contains("api"));
        let has_components = paths.iter().any(|p| p.contains("component") || p.contains("pages") || p.contains("views"));
        let has_cli = paths.iter().any(|p| p.contains("cli") || p.contains("command"));
        let has_sdk = paths.iter().any(|p| p.contains("client") || p.contains("sdk"));

        if has_routes { signals.push("route/api files found".into()); devdocs_score += 2.0; }
        if has_components { signals.push("component/page files found".into()); consumer_score += 2.0; }
        if has_cli { signals.push("CLI files found".into()); devdocs_score += 1.5; }
        if has_sdk { signals.push("SDK/client files found".into()); devdocs_score += 1.5; }
    }

    if let Ok(symbols) = client.get_all_symbols(repo_name).await {
        let has_decorators = symbols.iter().any(|s| {
            s.get("signature").and_then(|v| v.as_str())
                .map(|sig| sig.contains("@app.") || sig.contains("@router.") || sig.contains("app.get") || sig.contains("app.post"))
                .unwrap_or(false)
        });
        if has_decorators { signals.push("route decorators found -> API".into()); devdocs_score += 2.0; }
    }

    let total = consumer_score + devdocs_score;
    let (doc_type, confidence) = if total == 0.0 {
        ("devdocs".to_string(), 0.5)
    } else if devdocs_score > consumer_score {
        ("devdocs".to_string(), devdocs_score / total)
    } else {
        ("consumer".to_string(), consumer_score / total)
    };

    ClassificationResult { doc_type, confidence, signals }
}
