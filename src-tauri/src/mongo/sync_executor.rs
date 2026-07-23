use crate::db::diff_store;
use crate::models::{DiffKind, SyncResultEvent};
use crate::mongo::path_utils::get_nested_bson_value;
use anyhow::{Context, Result};
use bson::Document;
use mongodb::Client;
use rusqlite::Connection;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};

pub async fn execute_sync(
    app: &AppHandle,
    target_client: &Client,
    database: &str,
    source_collection: &str,
    target_collection: &str,
    _key_field: &str,
    sqlite_conn: Arc<Mutex<Connection>>,
) -> Result<(u64, u64)> {
    let mut succeeded = 0u64;
    let mut failed = 0u64;

    let db = target_client.database(database);
    let coll = db.collection::<Document>(target_collection);

    // 1. Inserts first — read from SQLite before any async work
    let inserts = {
        let conn = sqlite_conn.lock().unwrap();
        diff_store::query_diff_records(&conn, source_collection, "added", true, 0, i64::MAX)?
    };
    for rec in inserts {
        let result: Result<()> = async {
            let doc: Document = serde_json::from_str(&rec.source_doc)?;
            coll.insert_one(doc).await?;
            Ok(())
        }
        .await;
        let (ok, err) = match result {
            Ok(_) => {
                succeeded += 1;
                (true, None)
            }
            Err(e) => {
                failed += 1;
                (false, Some(e.to_string()))
            }
        };
        let _ = app.emit(
            "sync-result",
            SyncResultEvent {
                collection: source_collection.to_string(),
                key_value: rec.key_value.clone(),
                kind: DiffKind::Added,
                success: ok,
                error: err,
            },
        );
    }

    // 2. Updates — read from SQLite before async loop
    let updates = {
        let conn = sqlite_conn.lock().unwrap();
        diff_store::query_diff_records(&conn, source_collection, "modified", true, 0, i64::MAX)?
    };
    for rec in updates {
        let result: Result<()> = async {
            let src_doc: Document = serde_json::from_str(&rec.source_doc)?;
            let changed: Vec<String> =
                parse_changed_fields(&rec.changed_fields).with_context(|| {
                    format!(
                        "failed parsing changed_fields for collection '{}' key '{}'",
                        source_collection, rec.key_value
                    )
                })?;

            let mut set_doc = Document::new();
            let mut unset_doc = Document::new();
            for field in &changed {
                if field == "_id" {
                    continue;
                }
                if let Some(value) = get_nested_bson_value(&src_doc, field) {
                    set_doc.insert(field.clone(), value.clone());
                } else {
                    // Field exists in target but not source → remove from target
                    unset_doc.insert(field.clone(), bson::Bson::Int32(1));
                }
            }

            let key_bson: bson::Bson = if !rec.target_id.is_empty() {
                parse_key_bson(&rec.target_id)
            } else {
                parse_key_bson(&rec.key_value)
            };
            let filter = bson::doc! { "_id": key_bson };

            // First update: $set and/or $unset
            let mut first_update = Document::new();
            if !set_doc.is_empty() {
                first_update.insert("$set", set_doc);
            }
            if !unset_doc.is_empty() {
                first_update.insert("$unset", unset_doc);
            }
            if !first_update.is_empty() {
                coll.update_one(filter.clone(), first_update).await?;
            }

            Ok(())
        }
        .await;
        let (ok, err) = match result {
            Ok(_) => {
                succeeded += 1;
                (true, None)
            }
            Err(e) => {
                failed += 1;
                (false, Some(e.to_string()))
            }
        };
        let _ = app.emit(
            "sync-result",
            SyncResultEvent {
                collection: source_collection.to_string(),
                key_value: rec.key_value.clone(),
                kind: DiffKind::Modified,
                success: ok,
                error: err,
            },
        );
    }

    // 3. Deletes last — read from SQLite before async loop
    let deletes = {
        let conn = sqlite_conn.lock().unwrap();
        diff_store::query_diff_records(&conn, source_collection, "deleted", true, 0, i64::MAX)?
    };
    for rec in deletes {
        let result: Result<()> = async {
            let key_bson: bson::Bson = if !rec.target_id.is_empty() {
                parse_key_bson(&rec.target_id)
            } else {
                parse_key_bson(&rec.key_value)
            };
            let filter = bson::doc! { "_id": key_bson };
            coll.delete_one(filter).await?;
            Ok(())
        }
        .await;
        let (ok, err) = match result {
            Ok(_) => {
                succeeded += 1;
                (true, None)
            }
            Err(e) => {
                failed += 1;
                (false, Some(e.to_string()))
            }
        };
        let _ = app.emit(
            "sync-result",
            SyncResultEvent {
                collection: source_collection.to_string(),
                key_value: rec.key_value.clone(),
                kind: DiffKind::Deleted,
                success: ok,
                error: err,
            },
        );
    }

    Ok((succeeded, failed))
}

/// Parse a key value string (stored as JSON by the diff engine) into a BSON value.
/// Falls back to a string if JSON parsing fails.
fn parse_key_bson(key_value: &str) -> bson::Bson {
    serde_json::from_str::<serde_json::Value>(key_value)
        .ok()
        .and_then(|v| bson::to_bson(&v).ok())
        .unwrap_or_else(|| bson::Bson::String(key_value.to_string()))
}

/// Parse changed_fields JSON array strictly, returning Err if invalid.
/// This ensures malformed changed_fields JSON does not silently default to empty,
/// maintaining consistency with script_generator.rs strict parsing.
fn parse_changed_fields(raw: &str) -> Result<Vec<String>> {
    serde_json::from_str(raw).map_err(|e| anyhow::anyhow!("invalid changed_fields JSON: {}", e))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_key_bson_handles_string() {
        let bson = parse_key_bson(r#""hello""#);
        assert_eq!(bson, bson::Bson::String("hello".to_string()));
    }

    #[test]
    fn parse_key_bson_handles_integer() {
        let bson = parse_key_bson("42");
        assert_eq!(bson, bson::Bson::Int64(42));
    }

    #[test]
    fn parse_key_bson_handles_canonical_object_id() {
        let bson = parse_key_bson(r#"{"$oid":"507f1f77bcf86cd799439011"}"#);
        match bson {
            bson::Bson::ObjectId(oid) => {
                assert_eq!(oid.to_hex(), "507f1f77bcf86cd799439011");
            }
            other => panic!("expected ObjectId, got {:?}", other),
        }
    }

    #[test]
    fn parse_key_bson_falls_back_to_string() {
        // malformed JSON → string fallback
        let bson = parse_key_bson("not-json!");
        assert_eq!(bson, bson::Bson::String("not-json!".to_string()));
    }

    #[test]
    fn parse_changed_fields_handles_valid_json() {
        let result = parse_changed_fields(r#"["field1", "field2"]"#);
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), vec!["field1", "field2"]);
    }

    #[test]
    fn parse_changed_fields_handles_empty_array() {
        let result = parse_changed_fields("[]");
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), vec![] as Vec<String>);
    }

    #[test]
    fn parse_changed_fields_rejects_invalid_json() {
        let result = parse_changed_fields("not valid json");
        assert!(result.is_err());
        let err_msg = result.unwrap_err().to_string();
        assert!(err_msg.contains("invalid changed_fields JSON"));
    }

    #[test]
    fn parse_changed_fields_rejects_wrong_type() {
        // JSON object instead of array
        let result = parse_changed_fields(r#"{"field": "value"}"#);
        assert!(result.is_err());
    }

    #[test]
    fn parse_changed_fields_error_includes_context() {
        // Test that error message is useful for debugging
        let result = parse_changed_fields("not-valid-json");
        assert!(result.is_err());
        let err = result.unwrap_err().to_string();
        assert!(
            err.contains("invalid changed_fields JSON"),
            "error should mention changed_fields: {}",
            err
        );
    }

    // Note: Testing with_context wrapper for parse_changed_fields requires integration test
    // since it happens in async block within execute_sync function, but we verify the
    // parse_changed_fields function itself provides clear base error messages.
}
