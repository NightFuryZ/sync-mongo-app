use crate::db::diff_store;
use anyhow::{Context, Result};
use bson::{Bson, Document};
use chrono::{SecondsFormat, Utc};
use rusqlite::Connection;

pub struct ScriptConfig<'a> {
    pub collection: &'a str,        // source collection (for SQLite lookup)
    pub target_collection: &'a str, // target collection (for MongoDB writes)
    pub key_field: &'a str,
    pub target_database: &'a str,
}

fn quote_json(value: &str) -> String {
    serde_json::to_string(value).unwrap_or_else(|_| format!("\"{}\"", value))
}

fn format_object(entries: Vec<(String, String)>) -> String {
    if entries.is_empty() {
        return "{}".to_string();
    }

    let pairs = entries
        .into_iter()
        .map(|(key, value)| format!("{}: {}", quote_json(&key), value))
        .collect::<Vec<_>>()
        .join(", ");
    format!("{{ {} }}", pairs)
}

fn bson_to_ejson(value: &Bson) -> String {
    serde_json::to_string(value).unwrap_or_else(|_| "null".to_string())
}

fn bson_to_mongosh_compact(value: &Bson) -> String {
    match value {
        Bson::Double(n) => {
            if n.is_nan() {
                "NaN".to_string()
            } else if *n == f64::INFINITY {
                "Infinity".to_string()
            } else if *n == f64::NEG_INFINITY {
                "-Infinity".to_string()
            } else {
                n.to_string()
            }
        }
        Bson::String(s) => quote_json(s),
        Bson::Array(items) => {
            let values = items
                .iter()
                .map(bson_to_mongosh_compact)
                .collect::<Vec<_>>()
                .join(", ");
            format!("[{}]", values)
        }
        Bson::Document(doc) => format_object(
            doc.iter()
                .map(|(key, value)| (key.clone(), bson_to_mongosh_compact(value)))
                .collect(),
        ),
        Bson::Boolean(b) => b.to_string(),
        Bson::Null => "null".to_string(),
        Bson::RegularExpression(regex) => {
            format!(
                "RegExp({}, {})",
                quote_json(&regex.pattern),
                quote_json(&regex.options)
            )
        }
        Bson::JavaScriptCode(_)
        | Bson::JavaScriptCodeWithScope(_)
        | Bson::Symbol(_)
        | Bson::Undefined
        | Bson::DbPointer(_)
        | Bson::Timestamp(_)
        | Bson::Binary(_) => format!("EJSON.deserialize({})", bson_to_ejson(value)),
        Bson::Int32(n) => format!("NumberInt({})", n),
        Bson::Int64(n) => format!("NumberLong({})", quote_json(&n.to_string())),
        Bson::ObjectId(oid) => format!("ObjectId({})", quote_json(&oid.to_hex())),
        Bson::DateTime(dt) => format!(
            "new Date({})",
            quote_json(&dt.to_chrono().to_rfc3339_opts(SecondsFormat::Millis, true))
        ),
        Bson::Decimal128(n) => format!("NumberDecimal({})", quote_json(&n.to_string())),
        Bson::MinKey => "MinKey()".to_string(),
        Bson::MaxKey => "MaxKey()".to_string(),
    }
}

fn parse_document_strict(raw: &str, kind: &str, collection: &str, key: &str) -> Result<Document> {
    serde_json::from_str(raw).with_context(|| {
        format!(
            "invalid {} document for collection '{}' key '{}'",
            kind, collection, key
        )
    })
}

fn parse_optional_document_strict(
    raw: &str,
    kind: &str,
    collection: &str,
    key: &str,
) -> Result<Option<Document>> {
    if raw.trim().is_empty() {
        return Ok(None);
    }
    Ok(Some(parse_document_strict(raw, kind, collection, key)?))
}

fn get_nested_bson_value<'a>(doc: &'a Document, path: &str) -> Option<&'a Bson> {
    let mut current = doc.get(path.split('.').next()?)?;
    for part in path.split('.').skip(1) {
        current = match current {
            Bson::Document(map) => map.get(part)?,
            Bson::Array(items) => items.get(part.parse::<usize>().ok()?)?,
            _ => return None,
        };
    }
    Some(current)
}

fn parse_literal_from_key(raw: &str) -> Option<String> {
    serde_json::from_str::<serde_json::Value>(raw)
        .ok()
        .and_then(|value| bson::to_bson(&value).ok())
        .map(|value| bson_to_mongosh_compact(&value))
}

fn build_key_filter_from_doc(key_field: &str, doc: &Document) -> Option<String> {
    let entries = key_field
        .split(',')
        .map(|field| field.trim())
        .map(|field| {
            get_nested_bson_value(doc, field)
                .map(|value| (field.to_string(), bson_to_mongosh_compact(value)))
        })
        .collect::<Option<Vec<_>>>()?;
    Some(format_object(entries))
}

fn build_key_filter_from_raw(key_field: &str, key_value: &str) -> String {
    let fields: Vec<&str> = key_field.split(',').map(|s| s.trim()).collect();
    if fields.len() == 1 {
        let rendered = parse_literal_from_key(key_value).unwrap_or_else(|| quote_json(key_value));
        return format_object(vec![(fields[0].to_string(), rendered)]);
    }

    let values: Vec<&str> = key_value.splitn(fields.len(), '|').collect();
    let entries = fields
        .iter()
        .zip(values.iter())
        .map(|(field, value)| {
            (
                (*field).to_string(),
                parse_literal_from_key(value).unwrap_or_else(|| quote_json(value)),
            )
        })
        .collect();
    format_object(entries)
}

fn build_filter(
    key_field: &str,
    key_value: &str,
    target_id: &str,
    source_doc: Option<&Document>,
    target_doc: Option<&Document>,
) -> String {
    if !target_id.is_empty() {
        if let Some(doc) = target_doc.and_then(|doc| {
            doc.get("_id")
                .map(|id| format_object(vec![("_id".to_string(), bson_to_mongosh_compact(id))]))
        }) {
            return doc;
        }
    }

    if let Some(doc) = target_doc
        .and_then(|doc| build_key_filter_from_doc(key_field, doc))
        .or_else(|| source_doc.and_then(|doc| build_key_filter_from_doc(key_field, doc)))
    {
        return doc;
    }

    if !target_id.is_empty() {
        let rendered = parse_literal_from_key(target_id).unwrap_or_else(|| target_id.to_string());
        return format_object(vec![("_id".to_string(), rendered)]);
    }

    build_key_filter_from_raw(key_field, key_value)
}

pub fn generate_script(conn: &Connection, config: &ScriptConfig) -> Result<String> {
    let mut out = String::new();
    let now = Utc::now().to_rfc3339();

    // Header comment
    out.push_str(&format!(
        "// MongoDB Sync Script\n// Key: {}\n// Generated: {}\n// Set SYNC_MONGO_TARGET_URI before running this script.\n\n",
        quote_json(config.key_field),
        now
    ));
    out.push_str(&format!(
        "const targetDatabase = {};\nconst targetUri = process.env.SYNC_MONGO_TARGET_URI;\nif (!targetUri) throw new Error(\"SYNC_MONGO_TARGET_URI is required\");\nconst db = connect(targetUri).getSiblingDB(targetDatabase);\n\n",
        quote_json(config.target_database),
    ));

    // Inserts
    let inserts =
        diff_store::query_diff_records(conn, config.collection, "added", true, 0, i64::MAX)?;
    if !inserts.is_empty() {
        out.push_str(&format!("// --- INSERTS ({}) ---\n", inserts.len()));
        for rec in &inserts {
            let src_doc = parse_document_strict(
                &rec.source_doc,
                "source",
                config.collection,
                &rec.key_value,
            )?;
            let src_mongosh = bson_to_mongosh_compact(&Bson::Document(src_doc));
            out.push_str(&format!(
                "db.getCollection({}).insertOne({});\n",
                quote_json(config.target_collection),
                src_mongosh
            ));
        }
        out.push('\n');
    }

    // Updates — only $set changed fields from source doc
    let updates =
        diff_store::query_diff_records(conn, config.collection, "modified", true, 0, i64::MAX)?;
    if !updates.is_empty() {
        out.push_str(&format!("// --- UPDATES ({}) ---\n", updates.len()));
        for rec in &updates {
            let changed_fields: Vec<String> = serde_json::from_str(&rec.changed_fields)
                .with_context(|| {
                    format!(
                        "invalid changed_fields for modified document in collection '{}' key '{}'",
                        config.collection, rec.key_value
                    )
                })?;
            let source_doc = parse_optional_document_strict(
                &rec.source_doc,
                "source",
                config.collection,
                &rec.key_value,
            )?;
            let target_doc = parse_optional_document_strict(
                &rec.target_doc,
                "target",
                config.collection,
                &rec.key_value,
            )?;
            let filter = build_filter(
                config.key_field,
                &rec.key_value,
                &rec.target_id,
                source_doc.as_ref(),
                target_doc.as_ref(),
            );

            // Partition changed fields into $set (dot-traversal) and $unset (with __unset__ marker)
            let mut set_kvs: Vec<(String, Bson)> = vec![];
            let mut unset_paths: Vec<String> = vec![];
            for field in &changed_fields {
                if field == "_id" {
                    continue;
                }
                if let Some(val) = source_doc
                    .as_ref()
                    .and_then(|doc| get_nested_bson_value(doc, field))
                {
                    set_kvs.push((field.clone(), val.clone()));
                } else {
                    // Field exists in target but not source → remove from target
                    unset_paths.push(field.clone());
                }
            }

            let mut first_ops_entries: Vec<(String, String)> = vec![];
            if !set_kvs.is_empty() {
                first_ops_entries.push((
                    "$set".to_string(),
                    format_object(
                        set_kvs
                            .iter()
                            .map(|(key, value)| (key.clone(), bson_to_mongosh_compact(value)))
                            .collect(),
                    ),
                ));
            }
            if !unset_paths.is_empty() {
                first_ops_entries.push((
                    "$unset".to_string(),
                    format_object(
                        unset_paths
                            .iter()
                            .map(|path| (path.clone(), "1".to_string()))
                            .collect(),
                    ),
                ));
            }
            // First updateOne: $set and/or $unset (only emit if there are actual operations)
            if !first_ops_entries.is_empty() {
                let first_ops_body = format_object(first_ops_entries);
                out.push_str(&format!(
                    "db.getCollection({}).updateOne({}, {});\n",
                    quote_json(config.target_collection),
                    filter,
                    first_ops_body
                ));
            }
        }
        out.push('\n');
    }

    // Deletes
    let deletes =
        diff_store::query_diff_records(conn, config.collection, "deleted", true, 0, i64::MAX)?;
    if !deletes.is_empty() {
        out.push_str(&format!("// --- DELETES ({}) ---\n", deletes.len()));
        for rec in &deletes {
            let target_doc = parse_optional_document_strict(
                &rec.target_doc,
                "target",
                config.collection,
                &rec.key_value,
            )?;
            let filter = build_filter(
                config.key_field,
                &rec.key_value,
                &rec.target_id,
                None,
                target_doc.as_ref(),
            );
            out.push_str(&format!(
                "db.getCollection({}).deleteOne({});\n",
                quote_json(config.target_collection),
                filter
            ));
        }
    }

    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::diff_store::{create_schema, insert_diff};
    use crate::models::DiffKind;
    use rusqlite::Connection;

    fn setup_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        create_schema(&conn).unwrap();
        conn
    }

    fn make_config<'a>(
        conn: &'a Connection,
        collection: &'a str,
    ) -> (&'a Connection, ScriptConfig<'a>) {
        let config = ScriptConfig {
            collection,
            target_collection: collection,
            key_field: "_id",
            target_database: "mydb",
        };
        (conn, config)
    }

    #[test]
    fn generates_insert_script() {
        let conn = setup_db();
        insert_diff(
            &conn,
            "users",
            &DiffKind::Added,
            r#"ObjectId("abc123")"#,
            r#"{"_id":"abc123","name":"Alice"}"#,
            "",
            "[]",
            "",
            "{}",
        )
        .unwrap();
        let (conn_ref, config) = make_config(&conn, "users");
        let script = generate_script(conn_ref, &config).unwrap();
        assert!(script.contains("insertOne"), "should contain insertOne");
        assert!(script.contains("INSERTS (1)"), "should show count");
        assert!(script.contains("Alice"), "should contain doc data");
    }

    #[test]
    fn generates_update_script() {
        let conn = setup_db();
        insert_diff(
            &conn,
            "users",
            &DiffKind::Modified,
            r#"ObjectId("abc123")"#,
            r#"{"_id":"abc123","name":"Bob","age":30}"#,
            r#"{"_id":"abc123","name":"Alice","age":29}"#,
            r#"["name","age"]"#,
            "",
            "{}",
        )
        .unwrap();
        let (conn_ref, config) = make_config(&conn, "users");
        let script = generate_script(conn_ref, &config).unwrap();
        assert!(script.contains("updateOne"), "should contain updateOne");
        assert!(script.contains("$set"), "should contain $set");
        assert!(script.contains("UPDATES (1)"), "should show count");
    }

    #[test]
    fn generates_delete_script() {
        let conn = setup_db();
        insert_diff(
            &conn,
            "users",
            &DiffKind::Deleted,
            r#"ObjectId("xyz789")"#,
            "",
            r#"{"_id":"xyz789","name":"Charlie"}"#,
            "[]",
            "",
            "{}",
        )
        .unwrap();
        let (conn_ref, config) = make_config(&conn, "users");
        let script = generate_script(conn_ref, &config).unwrap();
        assert!(script.contains("deleteOne"), "should contain deleteOne");
        assert!(script.contains("DELETES (1)"), "should show count");
    }

    #[test]
    fn empty_diff_produces_header_only() {
        let conn = setup_db();
        let (conn_ref, config) = make_config(&conn, "empty_col");
        let script = generate_script(conn_ref, &config).unwrap();
        assert!(script.contains("MongoDB Sync Script"), "should have header");
        assert!(script.contains("connect("), "should have connect call");
        assert!(!script.contains("insertOne"), "no inserts");
        assert!(!script.contains("updateOne"), "no updates");
        assert!(!script.contains("deleteOne"), "no deletes");
    }

    #[test]
    fn generated_script_uses_environment_uri_and_escapes_collection_name() {
        let conn = setup_db();
        insert_diff(
            &conn,
            "users",
            &DiffKind::Added,
            r#"\"u1\""#,
            r#"{"_id":"u1","name":"Alice"}"#,
            "",
            "[]",
            "",
            "{}",
        )
        .unwrap();
        let config = ScriptConfig {
            collection: "users",
            target_collection: "users\"); db.dropDatabase(); //",
            key_field: "_id",
            target_database: "selected-db",
        };

        let script = generate_script(&conn, &config).unwrap();

        assert!(!script.contains("source-secret"));
        assert!(!script.contains("target-secret"));
        assert!(script.contains("const targetUri = process.env.SYNC_MONGO_TARGET_URI;"));
        assert!(script.contains("const db = connect(targetUri).getSiblingDB(targetDatabase);"));
        assert!(script.contains(&format!(
            "db.getCollection({})",
            quote_json(config.target_collection)
        )));
    }

    #[test]
    fn generated_script_never_updates_immutable_id_for_custom_key() {
        let conn = setup_db();
        insert_diff(
            &conn,
            "users",
            &DiffKind::Modified,
            r#"\"alice@example.com\""#,
            r#"{"_id":"source-id","email":"alice@example.com","name":"Alice"}"#,
            r#"{"_id":"target-id","email":"alice@example.com","name":"Old name"}"#,
            r#"["_id","name"]"#,
            r#"\"target-id\""#,
            "{}",
        )
        .unwrap();
        let config = ScriptConfig {
            collection: "users",
            target_collection: "users",
            key_field: "email",
            target_database: "target-db",
        };

        let script = generate_script(&conn, &config).unwrap();

        assert!(!script.contains(r#""_id": "source-id""#));
        assert!(script.contains(r#""name": "Alice""#));
    }

    #[test]
    fn only_selected_records_included() {
        let conn = setup_db();
        // Insert two added records
        let id1 = insert_diff(
            &conn,
            "col",
            &DiffKind::Added,
            "k1",
            r#"{"name":"A"}"#,
            "",
            "[]",
            "",
            "{}",
        )
        .unwrap();
        insert_diff(
            &conn,
            "col",
            &DiffKind::Added,
            "k2",
            r#"{"name":"B"}"#,
            "",
            "[]",
            "",
            "{}",
        )
        .unwrap();
        // Deselect the first one
        crate::db::diff_store::set_selected(&conn, &[id1], false).unwrap();

        let (conn_ref, config) = make_config(&conn, "col");
        let script = generate_script(conn_ref, &config).unwrap();
        assert!(script.contains("INSERTS (1)"), "only 1 selected insert");
        assert!(script.contains(r#""name": "B""#), "B should be in script");
        assert!(
            !script.contains(r#""name": "A""#),
            "A should not be in script"
        );
    }

    #[test]
    fn generates_update_with_dot_notation_paths() {
        let conn = setup_db();
        insert_diff(
            &conn,
            "dSystemDefine",
            &DiffKind::Modified,
            "flavors-base",
            r#"{"_id":"flavors-base","list_define":[{"option":{"scale_min":2,"scale_max":2}}]}"#,
            r#"{"_id":"flavors-base","list_define":[{"option":{"scale_min":1,"scale_max":2}}]}"#,
            r#"["list_define.0.option.scale_min"]"#,
            "\"flavors-base\"",
            "{}",
        )
        .unwrap();
        let (conn_ref, config) = make_config(&conn, "dSystemDefine");
        let script = generate_script(conn_ref, &config).unwrap();
        assert!(
            script.contains("\"list_define.0.option.scale_min\""),
            "dot-notation key must be quoted in $set: got:\n{}",
            script
        );
        assert!(script.contains("updateOne"), "should use updateOne");
    }

    #[test]
    fn generates_full_array_replacement_for_length_change() {
        let conn = setup_db();
        insert_diff(
            &conn,
            "testCol",
            &DiffKind::Modified,
            "doc1",
            r#"{"_id":"doc1","items":[1,2]}"#,
            r#"{"_id":"doc1","items":[1,2,3]}"#,
            r#"["items"]"#,
            "\"doc1\"",
            "{}",
        )
        .unwrap();
        let (conn_ref, config) = make_config(&conn, "testCol");
        let script = generate_script(conn_ref, &config).unwrap();
        assert!(script.contains("$set"), "should replace the full array");
        assert!(script.contains(r#""items": [NumberInt(1), NumberInt(2)]"#));
        assert!(
            !script.contains("$pull"),
            "must not remove legitimate null values"
        );
        let count = script.matches("updateOne").count();
        assert_eq!(
            count, 1,
            "should emit one atomic replacement update: got:\n{}",
            script
        );
    }

    #[test]
    fn generates_update_with_field_and_array_replacement() {
        let conn = setup_db();
        insert_diff(
            &conn,
            "mixedCol",
            &DiffKind::Modified,
            "doc1",
            r#"{"_id":"doc1","name":"new","items":[1,2]}"#,
            r#"{"_id":"doc1","name":"old","items":[1,2,3]}"#,
            r#"["name", "items"]"#,
            "\"doc1\"",
            "{}",
        )
        .unwrap();
        let (conn_ref, config) = make_config(&conn, "mixedCol");
        let script = generate_script(conn_ref, &config).unwrap();
        assert!(script.contains("$set"), "should have $set for name change");
        assert!(script.contains(r#""items": [NumberInt(1), NumberInt(2)]"#));
        assert!(
            !script.contains("$pull"),
            "must not corrupt arrays containing null"
        );
        let count = script.matches("updateOne").count();
        assert_eq!(count, 1, "should emit one update command: got:\n{}", script);
    }

    #[test]
    fn generates_single_line_update_commands() {
        let conn = setup_db();
        insert_diff(
            &conn,
            "users",
            &DiffKind::Modified,
            r#""doc1""#,
            r#"{"_id":"doc1","profile":{"name":"Bob"}}"#,
            r#"{"_id":"doc1","profile":{"name":"Alice"}}"#,
            r#"["profile.name"]"#,
            r#""doc1""#,
            "{}",
        )
        .unwrap();

        let (conn_ref, config) = make_config(&conn, "users");
        let script = generate_script(conn_ref, &config).unwrap();
        let update_lines: Vec<&str> = script
            .lines()
            .filter(|line| line.contains("db.getCollection(\"users\").updateOne"))
            .collect();

        assert_eq!(
            update_lines.len(),
            1,
            "should emit a single update command line: got\n{}",
            script
        );
        assert_eq!(
            update_lines[0],
            r#"db.getCollection("users").updateOne({ "_id": "doc1" }, { "$set": { "profile.name": "Bob" } });"#,
            "update command should stay on one line: got\n{}",
            script
        );
    }

    #[test]
    fn preserves_number_long_in_generated_script() {
        let conn = setup_db();
        let source_doc = bson::Bson::Document(bson::doc! {
            "_id": bson::Bson::Int64(42),
            "counter": bson::Bson::Int64(9_007_199_254_740_993_i64),
        })
        .into_canonical_extjson()
        .to_string();
        insert_diff(
            &conn,
            "jobs",
            &DiffKind::Added,
            "42",
            &source_doc,
            "",
            "[]",
            "",
            "{}",
        )
        .unwrap();

        let target_doc = bson::Bson::Document(bson::doc! {
            "_id": bson::Bson::Int64(42),
        })
        .into_canonical_extjson()
        .to_string();
        insert_diff(
            &conn,
            "jobs",
            &DiffKind::Deleted,
            "42",
            "",
            &target_doc,
            "[]",
            "42",
            "{}",
        )
        .unwrap();

        let (conn_ref, config) = make_config(&conn, "jobs");
        let script = generate_script(conn_ref, &config).unwrap();

        assert!(
            script.contains(r#"db.getCollection("jobs").insertOne({ "_id": NumberLong("42"), "counter": NumberLong("9007199254740993") });"#),
            "insert should preserve NumberLong values: got\n{}",
            script
        );
        assert!(
            script.contains(r#"db.getCollection("jobs").deleteOne({ "_id": NumberLong("42") });"#),
            "delete filter should preserve NumberLong keys: got\n{}",
            script
        );
    }

    #[test]
    fn generate_script_returns_error_for_invalid_insert_document() {
        let conn = setup_db();
        insert_diff(
            &conn,
            "users",
            &DiffKind::Added,
            r#""u1""#,
            "{not-valid-json",
            "",
            "[]",
            "",
            "{}",
        )
        .unwrap();

        let (conn_ref, config) = make_config(&conn, "users");
        let err = generate_script(conn_ref, &config).unwrap_err().to_string();
        assert!(err.contains("users"));
        assert!(err.contains("u1"));
    }

    #[test]
    fn generate_script_returns_error_for_invalid_update_document() {
        let conn = setup_db();
        insert_diff(
            &conn,
            "users",
            &DiffKind::Modified,
            r#""u1""#,
            "{bad-source",
            r#"{"_id":"u1"}"#,
            r#"["name"]"#,
            r#""u1""#,
            "{}",
        )
        .unwrap();

        let (conn_ref, config) = make_config(&conn, "users");
        let err = generate_script(conn_ref, &config).unwrap_err().to_string();
        assert!(err.contains("source"));
        assert!(err.contains("users"));
        assert!(err.contains("u1"));
    }

    #[test]
    fn generate_script_returns_error_for_malformed_changed_fields() {
        let conn = setup_db();
        insert_diff(
            &conn,
            "orders",
            &DiffKind::Modified,
            r#""order1""#,
            r#"{"_id":"order1","status":"shipped"}"#,
            r#"{"_id":"order1","status":"pending"}"#,
            "not-valid-json-array",
            r#""order1""#,
            "{}",
        )
        .unwrap();

        let (conn_ref, config) = make_config(&conn, "orders");
        let err = generate_script(conn_ref, &config).unwrap_err().to_string();
        assert!(
            err.contains("invalid changed_fields"),
            "error should mention invalid changed_fields: {}",
            err
        );
        assert!(
            err.contains("orders"),
            "error should include collection name: {}",
            err
        );
        assert!(
            err.contains("order1"),
            "error should include key value: {}",
            err
        );
    }

    #[test]
    fn missing_changed_field_in_source_generates_unset() {
        let conn = setup_db();
        // Source doc has "name" but NOT "email" field
        // changed_fields lists both "name" and "email"
        // Expected: "name" → $set, "email" → $unset (not skipped)
        insert_diff(
            &conn,
            "users",
            &DiffKind::Modified,
            r#""u2""#,
            r#"{"_id":"u2","name":"Alice"}"#,
            r#"{"_id":"u2","name":"Bob","email":"bob@example.com"}"#,
            r#"["name","email"]"#,
            r#""u2""#,
            "{}",
        )
        .unwrap();

        let (conn_ref, config) = make_config(&conn, "users");
        let script = generate_script(conn_ref, &config).unwrap();
        assert!(script.contains("$set"), "should have $set for name field");
        assert!(
            script.contains(r#""name": "Alice""#),
            "should set name to Alice"
        );
        assert!(
            script.contains("$unset"),
            "should have $unset for missing email field"
        );
        assert!(script.contains(r#""email""#), "should unset email field");
    }

    #[test]
    fn empty_changed_fields_skips_no_op_update() {
        let conn = setup_db();
        // A modified record with empty changed_fields should NOT emit any updateOne
        // (or if it does emit updateOne, it must not be a no-op `updateOne({}, {})`)
        insert_diff(
            &conn,
            "users",
            &DiffKind::Modified,
            r#""u3""#,
            r#"{"_id":"u3","name":"Alice"}"#,
            r#"{"_id":"u3","name":"Alice"}"#,
            r#"[]"#, // empty changed_fields
            r#""u3""#,
            "{}",
        )
        .unwrap();

        let (conn_ref, config) = make_config(&conn, "users");
        let script = generate_script(conn_ref, &config).unwrap();

        // Should NOT contain a no-op updateOne with empty update operator body
        assert!(!script.contains(r#"updateOne({ "_id": "u3" }, {})"#), 
                "should not emit no-op updateOne with empty braces when changed_fields is empty: got\n{}", 
                script);
        // Should also check that no updateOne line is generated for this record at all
        let update_lines: Vec<&str> = script
            .lines()
            .filter(|line| line.contains("updateOne"))
            .collect();
        assert_eq!(
            update_lines.len(),
            0,
            "should not emit any updateOne for empty changed_fields: got\n{}",
            script
        );
    }

    #[test]
    fn array_replacement_does_not_emit_pull() {
        let conn = setup_db();
        insert_diff(
            &conn,
            "testCol",
            &DiffKind::Modified,
            "doc1",
            r#"{"_id":"doc1","items":[1,2]}"#,
            r#"{"_id":"doc1","items":[1,2,3]}"#,
            r#"["items"]"#,
            "\"doc1\"",
            "{}",
        )
        .unwrap();

        let (conn_ref, config) = make_config(&conn, "testCol");
        let script = generate_script(conn_ref, &config).unwrap();

        assert!(script.contains("$set"), "should replace the array");
        assert!(
            !script.contains("$pull"),
            "should not delete all null values"
        );
        let count = script.matches("updateOne").count();
        assert_eq!(
            count, 1,
            "should emit one replacement update: got:\n{}",
            script
        );
    }
    #[test]
    fn build_filter_renders_canonical_object_id_target_id() {
        let filter = build_filter(
            "_id",
            r#"{"$oid":"507f1f77bcf86cd799439011"}"#,
            r#"{"$oid":"507f1f77bcf86cd799439011"}"#,
            None,
            None,
        );

        assert_eq!(filter, r#"{ "_id": ObjectId("507f1f77bcf86cd799439011") }"#);
    }
}
