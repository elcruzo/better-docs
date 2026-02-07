use axum::{routing::{get, post}, Router, response::Json, extract::State};
use serde_json::{json, Value};
use std::net::SocketAddr;
use std::sync::Arc;
use tower_http::cors::{CorsLayer, Any};

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
    tracing_subscriber::fmt::init();

    let uri = std::env::var("NEO4J_URI").unwrap_or_else(|_| "bolt://localhost:7687".to_string());
    let user = std::env::var("NEO4J_USER").unwrap_or_else(|_| "neo4j".to_string());
    let pass = std::env::var("NEO4J_PASSWORD").unwrap_or_else(|_| "password".to_string());

    let graph_client = match GraphClient::connect(&uri, &user, &pass).await {
        Ok(client) => {
            let _ = client.ensure_schema().await;
            Some(Arc::new(client))
        }
        Err(_) => None,
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
    println!("Engine running on {}", addr);
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
    let stats = indexing::index_repository(&payload.repo_path, &payload.repo_name, state.graph.clone()).await;
    Json(json!(stats))
}

#[derive(serde::Deserialize)]
struct ParseRequest {
    filename: String,
    content: String,
    repo_name: Option<String>,
}

async fn parse_file(State(state): State<Arc<AppState>>, Json(payload): Json<ParseRequest>) -> Json<Value> {
    let result = parsing::parse_content(&payload.filename, &payload.content);
    let ingested = if let (Some(client), Some(repo)) = (&state.graph, &payload.repo_name) {
        client.ingest_symbols(repo, &payload.filename, &result).await.is_ok()
    } else {
        false
    };
    Json(json!({ "parsing": result, "ingested": ingested }))
}

#[derive(serde::Deserialize)]
struct ClassifyRequest {
    repo_name: String,
}

async fn classify_repo(State(state): State<Arc<AppState>>, Json(payload): Json<ClassifyRequest>) -> Json<Value> {
    if let Some(client) = &state.graph {
        let result = classifier::classify(client, &payload.repo_name).await;
        Json(json!(result))
    } else {
        Json(json!({ "doc_type": "devdocs", "confidence": 0.0, "signals": [] }))
    }
}

#[derive(serde::Deserialize)]
struct GraphQueryRequest {
    repo_name: String,
    query_type: String,
}

async fn query_graph(State(state): State<Arc<AppState>>, Json(payload): Json<GraphQueryRequest>) -> Json<Value> {
    if let Some(client) = &state.graph {
        match payload.query_type.as_str() {
            "symbols" => {
                let symbols = client.get_all_symbols(&payload.repo_name).await.unwrap_or_default();
                Json(json!({ "symbols": symbols }))
            }
            "files" => {
                let files = client.get_all_files(&payload.repo_name).await.unwrap_or_default();
                Json(json!({ "files": files }))
            }
            "structure" => {
                let structure = client.get_repo_structure(&payload.repo_name).await.unwrap_or_default();
                Json(json!({ "structure": structure }))
            }
            _ => Json(json!({ "error": "unknown query_type" })),
        }
    } else {
        Json(json!({ "error": "no database connection" }))
    }
}
