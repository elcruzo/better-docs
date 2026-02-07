use axum::{routing::{get, post}, Router, response::Json, extract::State};
use serde_json::{json, Value};
use std::net::SocketAddr;
use std::sync::Arc;
use tower_http::cors::{CorsLayer, Any};
use tracing::{info, warn, error};

mod parsing;
mod graph;
mod indexing;
mod classifier;

use graph::GraphClient;

struct AppState {
    graph: Option<Arc<GraphClient>>,
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_target(false)
        .with_timer(tracing_subscriber::fmt::time::uptime())
        .init();

    // Set rayon thread stack size to 8MB to prevent stack overflow on deeply nested files
    rayon::ThreadPoolBuilder::new()
        .stack_size(8 * 1024 * 1024)
        .build_global()
        .ok();

    let uri = std::env::var("NEO4J_URI").unwrap_or_else(|_| "bolt://localhost:7687".to_string());
    let user = std::env::var("NEO4J_USER").unwrap_or_else(|_| "neo4j".to_string());
    let pass = std::env::var("NEO4J_PASSWORD").unwrap_or_else(|_| "betterdocs".to_string());

    info!("Connecting to Neo4j at {} as {}", uri, user);

    let graph_client = match GraphClient::connect(&uri, &user, &pass).await {
        Ok(client) => {
            info!("Neo4j connected successfully");
            match client.ensure_schema().await {
                Ok(_) => info!("Neo4j schema ready"),
                Err(e) => error!("Neo4j schema setup failed: {}", e),
            }
            Some(Arc::new(client))
        }
        Err(e) => {
            error!("Neo4j connection FAILED: {} -- engine will run without database", e);
            None
        }
    };

    let shared_state = Arc::new(AppState { graph: graph_client });
    let cors = CorsLayer::new().allow_origin(Any).allow_methods(Any).allow_headers(Any);

    let app = Router::new()
        .route("/health", get(health_check))
        .route("/index", post(index_repo))
        .route("/parse", post(parse_file))
        .route("/classify", post(classify_repo))
        .route("/graph/query", post(query_graph))
        .layer(cors)
        .with_state(shared_state);

    let addr = SocketAddr::from(([0, 0, 0, 0], 3001));
    info!("Engine running on http://{}", addr);
    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}

async fn health_check(State(state): State<Arc<AppState>>) -> Json<Value> {
    let db = if state.graph.is_some() { "connected" } else { "disconnected" };
    Json(json!({ "status": "ok", "service": "better-docs", "database": db }))
}

#[derive(serde::Deserialize)]
struct IndexRequest {
    repo_path: String,
    repo_name: String,
}

async fn index_repo(State(state): State<Arc<AppState>>, Json(payload): Json<IndexRequest>) -> Json<Value> {
    info!("POST /index -- repo={} path={}", payload.repo_name, payload.repo_path);
    let start = std::time::Instant::now();
    let stats = indexing::index_repository(&payload.repo_path, &payload.repo_name, state.graph.clone()).await;
    let elapsed = start.elapsed();
    info!("  Indexed {} files ({} skipped), {} nodes created in {:.1}s",
        stats.files_processed, stats.files_skipped, stats.nodes_created, elapsed.as_secs_f64());
    Json(json!(stats))
}

#[derive(serde::Deserialize)]
struct ParseRequest {
    filename: String,
    content: String,
    repo_name: Option<String>,
}

async fn parse_file(State(state): State<Arc<AppState>>, Json(payload): Json<ParseRequest>) -> Json<Value> {
    info!("POST /parse -- file={}", payload.filename);
    let result = parsing::parse_content(&payload.filename, &payload.content);
    info!("  Parsed: {} symbols, {} imports", result.symbols.len(), result.imports.len());
    let ingested = if let (Some(client), Some(repo)) = (&state.graph, &payload.repo_name) {
        match client.ingest_symbols(repo, &payload.filename, &result).await {
            Ok(_) => { info!("  Ingested to Neo4j"); true }
            Err(e) => { error!("  Neo4j ingest failed: {}", e); false }
        }
    } else {
        warn!("  Skipping ingest (no db or no repo_name)");
        false
    };
    Json(json!({ "parsing": result, "ingested": ingested }))
}

#[derive(serde::Deserialize)]
struct ClassifyRequest {
    repo_name: String,
}

async fn classify_repo(State(state): State<Arc<AppState>>, Json(payload): Json<ClassifyRequest>) -> Json<Value> {
    info!("POST /classify -- repo={}", payload.repo_name);
    if let Some(client) = &state.graph {
        let result = classifier::classify(client, &payload.repo_name).await;
        info!("  Classified as {} (confidence: {:.2}), signals: {:?}", result.doc_type, result.confidence, result.signals);
        Json(json!(result))
    } else {
        warn!("  No database -- defaulting to devdocs");
        Json(json!({ "doc_type": "devdocs", "confidence": 0.0, "signals": [] }))
    }
}

#[derive(serde::Deserialize)]
struct GraphQueryRequest {
    repo_name: String,
    query_type: String,
}

async fn query_graph(State(state): State<Arc<AppState>>, Json(payload): Json<GraphQueryRequest>) -> Json<Value> {
    info!("POST /graph/query -- repo={} type={}", payload.repo_name, payload.query_type);
    if let Some(client) = &state.graph {
        match payload.query_type.as_str() {
            "symbols" => {
                let symbols = client.get_all_symbols(&payload.repo_name).await.unwrap_or_default();
                info!("  Returning {} symbols", symbols.len());
                Json(json!({ "symbols": symbols }))
            }
            "files" => {
                let files = client.get_all_files(&payload.repo_name).await.unwrap_or_default();
                info!("  Returning {} files", files.len());
                Json(json!({ "files": files }))
            }
            "structure" => {
                let structure = client.get_repo_structure(&payload.repo_name).await.unwrap_or_default();
                info!("  Returning structure for {} files", structure.len());
                Json(json!({ "structure": structure }))
            }
            _ => {
                warn!("  Unknown query_type: {}", payload.query_type);
                Json(json!({ "error": "unknown query_type" }))
            }
        }
    } else {
        error!("  No database connection");
        Json(json!({ "error": "no database connection" }))
    }
}
