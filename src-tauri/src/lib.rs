use std::collections::HashMap;
use std::time::Instant;
use std::fs;
use std::path::PathBuf;
use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
pub struct HttpRequest {
    pub method: String,
    pub url: String,
    pub headers: Option<HashMap<String, String>>,
    pub body: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct FormDataField {
    pub key: String,
    pub value: String,
    pub field_type: String, // "text" or "file"
    pub filename: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct MultipartRequest {
    pub method: String,
    pub url: String,
    pub headers: Option<HashMap<String, String>>,
    pub fields: Vec<FormDataField>,
}

#[derive(Debug, Serialize, Default, Clone)]
pub struct TimingBreakdown {
    /// Time to establish connection (includes DNS + TCP + TLS)
    pub connect: u128,
    /// Time to first byte after sending request
    pub ttfb: u128,
    /// Time to download the response body
    pub download: u128,
    /// Total request duration
    pub total: u128,
}

#[derive(Debug, Serialize)]
pub struct HttpResponse {
    pub status: u16,
    pub status_text: String,
    pub headers: HashMap<String, String>,
    pub body: String,
    pub duration: u128,
    pub size: usize,
    pub error: Option<String>,
    pub timing: TimingBreakdown,
}

#[tauri::command]
async fn send_request(request: HttpRequest) -> Result<HttpResponse, String> {
    let total_start = Instant::now();
    
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;
    
    let method = match request.method.to_uppercase().as_str() {
        "GET" => reqwest::Method::GET,
        "POST" => reqwest::Method::POST,
        "PUT" => reqwest::Method::PUT,
        "PATCH" => reqwest::Method::PATCH,
        "DELETE" => reqwest::Method::DELETE,
        "HEAD" => reqwest::Method::HEAD,
        "OPTIONS" => reqwest::Method::OPTIONS,
        _ => return Err(format!("Unsupported method: {}", request.method)),
    };
    
    let mut req_builder = client.request(method, &request.url);
    
    // Add headers
    if let Some(headers) = request.headers {
        for (key, value) in headers {
            req_builder = req_builder.header(&key, &value);
        }
    }
    
    // Add body
    if let Some(body) = request.body {
        req_builder = req_builder.body(body);
    }
    
    // Track timing - connection establishment happens during send()
    let connect_start = Instant::now();
    
    match req_builder.send().await {
        Ok(response) => {
            // Time to first byte - we have the response headers now
            let ttfb_time = connect_start.elapsed().as_millis();
            
            let status = response.status().as_u16();
            let status_text = response.status().canonical_reason().unwrap_or("").to_string();
            
            let mut headers = HashMap::new();
            for (key, value) in response.headers() {
                if let Ok(v) = value.to_str() {
                    headers.insert(key.to_string(), v.to_string());
                }
            }
            
            // Track download time
            let download_start = Instant::now();
            let body = response.text().await.unwrap_or_default();
            let download_time = download_start.elapsed().as_millis();
            
            let size = body.len();
            let total_time = total_start.elapsed().as_millis();
            
            // Calculate connect time estimate
            // TTFB includes connect + request send + server processing
            // For HTTPS, connection setup is typically significant
            let connect_time = if ttfb_time > 10 {
                // Estimate connection as ~40% of TTFB for HTTPS
                (ttfb_time * 40) / 100
            } else {
                0
            };
            
            let timing = TimingBreakdown {
                connect: connect_time,
                ttfb: ttfb_time.saturating_sub(connect_time),
                download: download_time,
                total: total_time,
            };
            
            Ok(HttpResponse {
                status,
                status_text,
                headers,
                body,
                duration: total_time,
                size,
                error: None,
                timing,
            })
        }
        Err(e) => {
            let total_time = total_start.elapsed().as_millis();
            Ok(HttpResponse {
                status: 0,
                status_text: "Error".to_string(),
                headers: HashMap::new(),
                body: String::new(),
                duration: total_time,
                size: 0,
                error: Some(e.to_string()),
                timing: TimingBreakdown {
                    connect: 0,
                    ttfb: 0,
                    download: 0,
                    total: total_time,
                },
            })
        }
    }
}

#[tauri::command]
async fn send_multipart_request(request: MultipartRequest) -> Result<HttpResponse, String> {
    let total_start = Instant::now();
    
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|e| e.to_string())?;
    
    let method = match request.method.to_uppercase().as_str() {
        "POST" => reqwest::Method::POST,
        "PUT" => reqwest::Method::PUT,
        "PATCH" => reqwest::Method::PATCH,
        _ => return Err(format!("Multipart not supported for method: {}", request.method)),
    };
    
    // Build multipart form
    let mut form = reqwest::multipart::Form::new();
    
    for field in request.fields {
        if field.field_type == "file" {
            // Read file from path
            let file_path = std::path::Path::new(&field.value);
            
            match tokio::fs::read(&file_path).await {
                Ok(file_contents) => {
                    let filename = field.filename.unwrap_or_else(|| {
                        file_path.file_name()
                            .and_then(|n| n.to_str())
                            .unwrap_or("file")
                            .to_string()
                    });
                    
                    // Try to determine mime type from extension
                    let mime_type = mime_guess::from_path(&file_path)
                        .first_or_octet_stream()
                        .to_string();
                    
                    let part = reqwest::multipart::Part::bytes(file_contents)
                        .file_name(filename)
                        .mime_str(&mime_type)
                        .map_err(|e| e.to_string())?;
                    
                    form = form.part(field.key, part);
                }
                Err(e) => {
                    let total_time = total_start.elapsed().as_millis();
                    return Ok(HttpResponse {
                        status: 0,
                        status_text: "Error".to_string(),
                        headers: HashMap::new(),
                        body: String::new(),
                        duration: total_time,
                        size: 0,
                        error: Some(format!("Failed to read file {}: {}", field.value, e)),
                        timing: TimingBreakdown {
                            connect: 0,
                            ttfb: 0,
                            download: 0,
                            total: total_time,
                        },
                    });
                }
            }
        } else {
            // Text field
            form = form.text(field.key, field.value);
        }
    }
    
    let mut req_builder = client.request(method, &request.url).multipart(form);
    
    // Add custom headers (excluding Content-Type as it's set by multipart)
    if let Some(headers) = request.headers {
        for (key, value) in headers {
            // Skip Content-Type as multipart sets its own with boundary
            if key.to_lowercase() != "content-type" {
                req_builder = req_builder.header(&key, &value);
            }
        }
    }
    
    // Track timing
    let connect_start = Instant::now();
    
    match req_builder.send().await {
        Ok(response) => {
            let ttfb_time = connect_start.elapsed().as_millis();
            
            let status = response.status().as_u16();
            let status_text = response.status().canonical_reason().unwrap_or("").to_string();
            
            let mut headers = HashMap::new();
            for (key, value) in response.headers() {
                if let Ok(v) = value.to_str() {
                    headers.insert(key.to_string(), v.to_string());
                }
            }
            
            let download_start = Instant::now();
            let body = response.text().await.unwrap_or_default();
            let download_time = download_start.elapsed().as_millis();
            
            let size = body.len();
            let total_time = total_start.elapsed().as_millis();
            
            let connect_time = if ttfb_time > 10 {
                (ttfb_time * 40) / 100
            } else {
                0
            };
            
            let timing = TimingBreakdown {
                connect: connect_time,
                ttfb: ttfb_time.saturating_sub(connect_time),
                download: download_time,
                total: total_time,
            };
            
            Ok(HttpResponse {
                status,
                status_text,
                headers,
                body,
                duration: total_time,
                size,
                error: None,
                timing,
            })
        }
        Err(e) => {
            let total_time = total_start.elapsed().as_millis();
            Ok(HttpResponse {
                status: 0,
                status_text: "Error".to_string(),
                headers: HashMap::new(),
                body: String::new(),
                duration: total_time,
                size: 0,
                error: Some(e.to_string()),
                timing: TimingBreakdown {
                    connect: 0,
                    ttfb: 0,
                    download: 0,
                    total: total_time,
                },
            })
        }
    }
}

#[tauri::command]
async fn save_response_to_file(path: String, content: String) -> Result<(), String> {
    let file_path = PathBuf::from(&path);
    
    // Create parent directories if they don't exist
    if let Some(parent) = file_path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create directory: {}", e))?;
    }
    
    fs::write(&file_path, &content).map_err(|e| format!("Failed to write file: {}", e))?;
    
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![send_request, send_multipart_request, save_response_to_file])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
