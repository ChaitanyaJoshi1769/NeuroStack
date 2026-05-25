use axum::{
    extract::{Json, State},
    http::StatusCode,
    routing::{get, post},
    Router,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::{info, warn};
use uuid::Uuid;

/// Query request model
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct QueryRequest {
    pub query: String,
    #[serde(default)]
    pub semantic: bool,
    #[serde(default)]
    pub include_vectors: bool,
    pub tenant_id: String,
}

/// Query response model
#[derive(Debug, Serialize, Deserialize)]
pub struct QueryResponse {
    pub query_id: String,
    pub success: bool,
    pub rows: Vec<serde_json::Value>,
    pub row_count: usize,
    pub duration_ms: u128,
    pub timestamp: String,
}

/// Health check response
#[derive(Debug, Serialize, Deserialize)]
pub struct HealthResponse {
    pub status: String,
    pub version: String,
    pub service: String,
    pub timestamp: String,
}

/// Application state
#[derive(Clone)]
pub struct AppState {
    queries: Arc<RwLock<Vec<QueryRequest>>>,
}

/// Health check handler
async fn health_check() -> (StatusCode, Json<HealthResponse>) {
    let response = HealthResponse {
        status: "healthy".to_string(),
        version: "0.1.0".to_string(),
        service: "query-runtime".to_string(),
        timestamp: chrono::Utc::now().to_rfc3339(),
    };

    (StatusCode::OK, Json(response))
}

/// Root handler
async fn root() -> Json<serde_json::json::Value> {
    Json(serde_json::json!({
        "message": "NeuroStack Query Runtime",
        "version": "0.1.0",
        "features": [
            "SQL execution",
            "Vector queries",
            "Semantic joins",
            "Distributed execution"
        ]
    }))
}

/// Execute query handler
async fn execute_query(
    State(state): State<AppState>,
    Json(request): Json<QueryRequest>,
) -> (StatusCode, Json<QueryResponse>) {
    info!(query = %request.query, "Executing query");

    let start_time = std::time::Instant::now();

    // Mock query execution
    let query_id = Uuid::new_v4().to_string();

    // In production, this would:
    // 1. Parse SQL/semantic query
    // 2. Optimize query plan
    // 3. Execute against DuckDB/ClickHouse
    // 4. Handle vector portions
    // 5. Merge and rank results

    let rows = vec![
        serde_json::json!({"id": 1, "value": "test", "score": 0.95}),
        serde_json::json!({"id": 2, "value": "sample", "score": 0.87}),
    ];

    let duration_ms = start_time.elapsed().as_millis();

    // Store query in state
    {
        let mut queries = state.queries.write().await;
        queries.push(request);
    }

    let response = QueryResponse {
        query_id,
        success: true,
        rows,
        row_count: 2,
        duration_ms,
        timestamp: chrono::Utc::now().to_rfc3339(),
    };

    (StatusCode::OK, Json(response))
}

/// List queries handler
async fn list_queries(State(state): State<AppState>) -> Json<serde_json::json::Value> {
    let queries = state.queries.read().await;

    Json(serde_json::json!({
        "total": queries.len(),
        "queries": queries.iter().map(|q| {
            serde_json::json!({
                "query": q.query,
                "tenant_id": q.tenant_id,
                "semantic": q.semantic
            })
        }).collect::<Vec<_>>()
    }))
}

/// Status handler
async fn status() -> Json<serde_json::json::Value> {
    Json(serde_json::json!({
        "status": "operational",
        "version": "0.1.0",
        "components": {
            "sql_engine": "ready",
            "vector_engine": "ready",
            "semantic_layer": "ready",
            "query_optimizer": "ready"
        },
        "timestamp": chrono::Utc::now().to_rfc3339()
    }))
}

#[tokio::main]
async fn main() {
    // Initialize tracing
    tracing_subscriber::fmt()
        .with_max_level(tracing::Level::INFO)
        .init();

    info!("Starting NeuroStack Query Runtime");
    info!("Version: 0.1.0");

    let state = AppState {
        queries: Arc::new(RwLock::new(Vec::new())),
    };

    let app = Router::new()
        .route("/", get(root))
        .route("/health", get(health_check))
        .route("/status", get(status))
        .route("/query", post(execute_query))
        .route("/queries", get(list_queries))
        .layer(tower_http::cors::CorsLayer::permissive())
        .with_state(state);

    let listener = tokio::net::TcpListener::bind("0.0.0.0:3002")
        .await
        .expect("Failed to bind port");

    info!("Query Runtime listening on port 3002");

    axum::serve(listener, app)
        .await
        .expect("Server failed");
}
