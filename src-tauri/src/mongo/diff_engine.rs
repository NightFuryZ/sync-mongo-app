use crate::db::diff_store;
use crate::models::{DiffKind, ProgressEvent};
use anyhow::Result;
use bson::{doc, Document};
use futures_util::TryStreamExt;
use mongodb::Client;
use rusqlite::Connection;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};

const BATCH_SIZE: u32 = 1000;

fn serialize_document(doc: &Document) -> String {
    bson::Bson::Document(doc.clone())
        .into_canonical_extjson()
        .to_string()
}

fn hash_doc(doc: &Document) -> String {
    let json = serialize_document(doc);
    let mut hasher = Sha256::new();
    hasher.update(json.as_bytes());
    hex::encode(hasher.finalize())
}

fn get_id_value(doc: &Document) -> String {
    doc.get("_id")
        .map(|v| v.clone().into_canonical_extjson().to_string())
        .unwrap_or_default()
}

fn get_key_value(doc: &Document, key_field: &str) -> String {
    let parts: Vec<&str> = key_field.split(',').map(|s| s.trim()).collect();
    if parts.len() == 1 {
        doc.get(parts[0])
            .map(|v| v.to_string())
            .unwrap_or_else(|| "__missing__".to_string())
    } else {
        // Composite key: join values with "|"
        let values: Vec<String> = parts
            .iter()
            .map(|field| {
                doc.get(*field)
                    .map(|v| v.to_string())
                    .unwrap_or_else(|| "__missing__".to_string())
            })
            .collect();
        if values.iter().any(|v| v == "__missing__") {
            "__missing__".to_string()
        } else {
            values.join("|")
        }
    }
}

/// Returns dot-notation paths of all fields that differ between source and target.
/// Recurses into nested Documents and Arrays.
/// For Arrays of different length: recurse overlap, emit extra source positions as "path.N",
/// emit extra target positions as "path.__unset__.N".
pub fn diff_fields(source: &Document, target: &Document) -> Vec<String> {
    let mut changed = vec![];
    diff_docs(source, target, "", false, &mut changed);
    changed
}

pub fn diff_fields_for_key(source: &Document, target: &Document, key_field: &str) -> Vec<String> {
    let mut changed = vec![];
    let preserves_target_id = !key_field
        .split(',')
        .map(str::trim)
        .any(|field| field == "_id");
    diff_docs(source, target, "", preserves_target_id, &mut changed);
    changed
}

fn diff_docs(
    source: &Document,
    target: &Document,
    prefix: &str,
    ignore_root_id: bool,
    out: &mut Vec<String>,
) {
    for (k, sv) in source.iter() {
        if ignore_root_id && prefix.is_empty() && k == "_id" {
            continue;
        }
        let path = if prefix.is_empty() {
            k.clone()
        } else {
            format!("{}.{}", prefix, k)
        };
        match target.get(k) {
            None => out.push(path),
            Some(tv) => diff_bson_values(sv, tv, &path, out),
        }
    }
    for k in target.keys() {
        if ignore_root_id && prefix.is_empty() && k == "_id" {
            continue;
        }
        if source.get(k).is_none() {
            let path = if prefix.is_empty() {
                k.clone()
            } else {
                format!("{}.{}", prefix, k)
            };
            out.push(path);
        }
    }
}

fn diff_bson_values(sv: &bson::Bson, tv: &bson::Bson, path: &str, out: &mut Vec<String>) {
    use bson::Bson;
    match (sv, tv) {
        (Bson::Document(sd), Bson::Document(td)) => {
            diff_docs(sd, td, path, false, out);
        }
        (Bson::Array(sa), Bson::Array(ta)) => {
            if sa.len() != ta.len() {
                out.push(path.to_string());
                return;
            }
            for (i, (se, te)) in sa.iter().zip(ta.iter()).enumerate() {
                let elem_path = format!("{}.{}", path, i);
                diff_bson_values(se, te, &elem_path, out);
            }
        }
        _ => {
            if sv != tv {
                out.push(path.to_string());
            }
        }
    }
}

/// Look up referenced documents from the same source database and build a JSON label map.
/// Returns: { "app_id": { "name": "MyApp", "version": "2.1" }, "user_id": { "username": "alice" } }
async fn resolve_ref_labels(
    db: &mongodb::Database,
    doc: &bson::Document,
    ref_configs: &[crate::models::ReferenceFieldConfig],
) -> String {
    let mut result = serde_json::Map::new();
    for rc in ref_configs {
        let local_val = match doc.get(&rc.local_field) {
            Some(v) => v.clone(),
            None => continue,
        };
        let coll = db.collection::<bson::Document>(&rc.ref_collection);
        let filter = bson::doc! { "_id": local_val };
        if let Ok(Some(ref_doc)) = coll.find_one(filter).await {
            let mut field_map = serde_json::Map::new();
            for field in &rc.display_fields {
                if let Some(val) = ref_doc.get(field) {
                    let display = match val {
                        bson::Bson::String(s) => serde_json::Value::String(s.clone()),
                        bson::Bson::Int32(n) => serde_json::Value::Number((*n).into()),
                        bson::Bson::Int64(n) => serde_json::Value::Number((*n).into()),
                        bson::Bson::Double(n) => serde_json::Number::from_f64(*n)
                            .map(serde_json::Value::Number)
                            .unwrap_or_else(|| serde_json::Value::String(n.to_string())),
                        bson::Bson::Boolean(b) => serde_json::Value::Bool(*b),
                        other => serde_json::Value::String(other.to_string()),
                    };
                    field_map.insert(field.clone(), display);
                }
            }
            result.insert(rc.local_field.clone(), serde_json::Value::Object(field_map));
        }
    }
    serde_json::to_string(&result).unwrap_or_else(|_| "{}".to_string())
}

pub async fn run_diff(
    app: &AppHandle,
    source_client: &Client,
    target_client: &Client,
    source_database: &str,
    target_database: &str,
    config: &crate::models::CollectionConfig,
    sqlite_conn: Arc<Mutex<Connection>>,
) -> Result<()> {
    let source_collection = config.name.as_str();
    let target_collection = config.target_name.as_str();
    let key_field = config.key_field.as_str();

    {
        let conn = sqlite_conn.lock().unwrap();
        diff_store::clear_collection(&conn, source_collection)?;
    }

    let emit_progress = |processed: u64, estimated: u64, phase: &str, msg: Option<String>| {
        let _ = app.emit(
            "diff-progress",
            ProgressEvent {
                collection: source_collection.to_string(),
                processed,
                estimated,
                phase: phase.to_string(),
                message: msg,
            },
        );
    };

    emit_progress(0, 0, "fetching", None);

    let src_db = source_client.database(source_database);
    let tgt_db = target_client.database(target_database);

    // Count estimated docs in source for progress
    let estimated = src_db
        .collection::<Document>(source_collection)
        .estimated_document_count()
        .await
        .unwrap_or(0);

    emit_progress(0, estimated, "fetching", None);

    // Fetch source docs: key → (hash, doc)
    let mut source_map: HashMap<String, (String, Document)> = HashMap::new();
    {
        let opts = mongodb::options::FindOptions::builder()
            .batch_size(BATCH_SIZE)
            .build();
        let mut cursor = src_db
            .collection::<Document>(source_collection)
            .find(doc! {})
            .with_options(opts)
            .await?;
        while let Some(doc) = cursor.try_next().await? {
            let key = get_key_value(&doc, key_field);
            if key == "__missing__" {
                continue;
            }
            let hash = hash_doc(&doc);
            if source_map.insert(key.clone(), (hash, doc)).is_some() {
                anyhow::bail!(
                    "duplicate key '{}' in source collection '{}'",
                    key,
                    source_collection
                );
            }
        }
    }

    // Fetch target docs: key → (hash, doc)
    let mut target_map: HashMap<String, (String, Document)> = HashMap::new();
    {
        let opts = mongodb::options::FindOptions::builder()
            .batch_size(BATCH_SIZE)
            .build();
        let mut cursor = tgt_db
            .collection::<Document>(target_collection)
            .find(doc! {})
            .with_options(opts)
            .await?;
        while let Some(doc) = cursor.try_next().await? {
            let key = get_key_value(&doc, key_field);
            if key == "__missing__" {
                continue;
            }
            let hash = hash_doc(&doc);
            if target_map.insert(key.clone(), (hash, doc)).is_some() {
                anyhow::bail!(
                    "duplicate key '{}' in target collection '{}'",
                    key,
                    target_collection
                );
            }
        }
    }

    let total = source_map.len() + target_map.len();
    let mut processed = 0u64;

    // Pre-compute ref_labels for Added/Modified docs (async, before locking SQLite)
    let mut ref_labels_cache: HashMap<String, String> = HashMap::new();
    if !config.reference_fields.is_empty() {
        for (key, (src_hash, src_doc)) in &source_map {
            let is_added = !target_map.contains_key(key);
            let is_modified = !is_added
                && target_map
                    .get(key)
                    .map(|(h, _)| h != src_hash)
                    .unwrap_or(false);
            if is_added || is_modified {
                let labels = resolve_ref_labels(&src_db, src_doc, &config.reference_fields).await;
                ref_labels_cache.insert(key.clone(), labels);
            }
        }
    }

    // Detect Added and Modified — all SQLite writes done under a single lock after all async work
    {
        let conn = sqlite_conn.lock().unwrap();
        for (key, (src_hash, src_doc)) in &source_map {
            let ref_labels = ref_labels_cache
                .get(key)
                .map(|s| s.as_str())
                .unwrap_or("{}");
            match target_map.get(key) {
                None => {
                    // Added: in source, not in target
                    let src_json = serialize_document(src_doc);
                    diff_store::insert_diff(
                        &conn,
                        source_collection,
                        &DiffKind::Added,
                        key,
                        &src_json,
                        "",
                        "[]",
                        "",
                        ref_labels,
                    )?;
                }
                Some((tgt_hash, tgt_doc)) => {
                    if src_hash != tgt_hash {
                        // Modified: in both, hashes differ
                        let changed = diff_fields_for_key(src_doc, tgt_doc, key_field);
                        if !changed.is_empty() {
                            let src_json = serialize_document(src_doc);
                            let tgt_json = serialize_document(tgt_doc);
                            let changed_json =
                                serde_json::to_string(&changed).unwrap_or_else(|_| "[]".into());
                            let target_id = get_id_value(tgt_doc);
                            diff_store::insert_diff(
                                &conn,
                                source_collection,
                                &DiffKind::Modified,
                                key,
                                &src_json,
                                &tgt_json,
                                &changed_json,
                                &target_id,
                                ref_labels,
                            )?;
                        }
                    }
                }
            }
            processed += 1;
            if processed.is_multiple_of(500) {
                emit_progress(processed, total as u64, "diffing", None);
            }
        }

        // Detect Deleted: in target, not in source
        for key in target_map.keys() {
            if !source_map.contains_key(key) {
                let (_, tgt_doc) = target_map.get(key).unwrap();
                let tgt_json = serialize_document(tgt_doc);
                let target_id = get_id_value(tgt_doc);
                diff_store::insert_diff(
                    &conn,
                    source_collection,
                    &DiffKind::Deleted,
                    key,
                    "",
                    &tgt_json,
                    "[]",
                    &target_id,
                    "{}",
                )?;
            }
        }
    }

    emit_progress(total as u64, total as u64, "done", None);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deep_diff_detects_nested_change() {
        let src = doc! {
            "name": "Trino",
            "config": { "workers": 3_i32, "memory": "4GB" }
        };
        let tgt = doc! {
            "name": "Trino",
            "config": { "workers": 5_i32, "memory": "4GB" }
        };
        let changed = diff_fields(&src, &tgt);
        assert_eq!(changed, vec!["config.workers"]);
    }

    #[test]
    fn deep_diff_detects_array_element_change() {
        let src = doc! {
            "list": [
                { "option": { "scale_min": 1_i32, "scale_max": 2_i32 } },
                { "option": { "scale_min": 3_i32 } }
            ]
        };
        let tgt = doc! {
            "list": [
                { "option": { "scale_min": 99_i32, "scale_max": 2_i32 } },
                { "option": { "scale_min": 3_i32 } }
            ]
        };
        let changed = diff_fields(&src, &tgt);
        assert_eq!(changed, vec!["list.0.option.scale_min"]);
    }

    #[test]
    fn deep_diff_top_level_unchanged() {
        let src = doc! { "name": "Alice", "age": 30_i32 };
        let tgt = doc! { "name": "Alice", "age": 30_i32 };
        let changed = diff_fields(&src, &tgt);
        assert!(changed.is_empty());
    }

    #[test]
    fn deep_diff_field_added_in_nested() {
        let src = doc! { "info": { "x": 1_i32 } };
        let tgt = doc! { "info": { "x": 1_i32, "y": 2_i32 } };
        let changed = diff_fields(&src, &tgt);
        assert_eq!(changed, vec!["info.y"]);
    }

    #[test]
    fn deep_diff_array_length_change() {
        let src = doc! { "items": [1_i32, 2_i32] };
        let tgt = doc! { "items": [1_i32, 2_i32, 3_i32] };
        let changed = diff_fields(&src, &tgt);
        assert_eq!(changed, vec!["items"]);
    }

    #[test]
    fn deep_diff_array_same_length_fine_grained() {
        let src = doc! { "items": [bson::doc!{"x": 1_i32}, bson::doc!{"x": 2_i32}] };
        let tgt = doc! { "items": [bson::doc!{"x": 1_i32}, bson::doc!{"x": 9_i32}] };
        let changed = diff_fields(&src, &tgt);
        assert_eq!(changed, vec!["items.1.x"]);
    }

    #[test]
    fn deep_diff_array_source_longer() {
        // Array length changes must replace the full array to preserve legitimate null elements.
        let src = doc! { "items": [1_i32, 2_i32, 3_i32] };
        let tgt = doc! { "items": [1_i32, 2_i32] };
        let changed = diff_fields(&src, &tgt);
        assert_eq!(changed, vec!["items"]);
    }

    #[test]
    fn custom_key_diff_ignores_different_immutable_ids() {
        let src = doc! { "_id": "source-id", "email": "alice@example.com", "name": "Alice" };
        let tgt = doc! { "_id": "target-id", "email": "alice@example.com", "name": "Alice" };

        assert!(diff_fields_for_key(&src, &tgt, "email").is_empty());
    }

    #[test]
    fn diff_fields_detects_changes() {
        let src = doc! { "name": "Alice", "age": 30, "city": "Hanoi" };
        let tgt = doc! { "name": "Alice", "age": 31, "country": "VN" };
        let mut changed = diff_fields(&src, &tgt);
        changed.sort();
        assert!(
            changed.contains(&"age".to_string()),
            "should detect age change"
        );
        assert!(
            changed.contains(&"city".to_string()),
            "should detect city removed"
        );
        assert!(
            changed.contains(&"country".to_string()),
            "should detect country added"
        );
        assert!(
            !changed.contains(&"name".to_string()),
            "name unchanged should not appear"
        );
    }

    #[test]
    fn hash_is_deterministic() {
        let d = doc! { "a": 1, "b": "hello" };
        assert_eq!(hash_doc(&d), hash_doc(&d));
    }

    #[test]
    fn hash_differs_for_different_docs() {
        let d1 = doc! { "a": 1 };
        let d2 = doc! { "a": 2 };
        assert_ne!(hash_doc(&d1), hash_doc(&d2));
    }

    #[test]
    fn hash_distinguishes_int32_and_int64() {
        let int32_doc = doc! { "a": 42_i32 };
        let int64_doc = doc! { "a": 42_i64 };
        assert_ne!(hash_doc(&int32_doc), hash_doc(&int64_doc));
    }

    #[test]
    fn get_id_value_preserves_object_id_as_canonical_json() {
        let doc =
            doc! { "_id": bson::oid::ObjectId::parse_str("507f1f77bcf86cd799439011").unwrap() };
        assert_eq!(get_id_value(&doc), r#"{"$oid":"507f1f77bcf86cd799439011"}"#);
    }

    #[test]
    fn missing_key_returns_sentinel() {
        let d = doc! { "name": "Alice" };
        assert_eq!(get_key_value(&d, "_id"), "__missing__");
        assert_eq!(get_key_value(&d, "name"), "\"Alice\"");
    }
}
