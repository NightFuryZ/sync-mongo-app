//! Shared utilities for dot-notation path handling and __unset__ marker encoding.

pub const UNSET_MARKER: &str = ".__unset__.";

/// Traverse a serde_json Value using a dot-notation path like "a.0.b.c".
/// Handles both object keys and array indices.
pub fn get_nested_value<'a>(
    val: &'a serde_json::Value,
    path: &str,
) -> Option<&'a serde_json::Value> {
    let mut current = val;
    for part in path.split('.') {
        current = match current {
            serde_json::Value::Object(map) => map.get(part)?,
            serde_json::Value::Array(arr) => arr.get(part.parse::<usize>().ok()?)?,
            _ => return None,
        };
    }
    Some(current)
}

/// Traverse a BSON document using dot notation without converting canonical EJSON scalars.
pub fn get_nested_bson_value<'a>(doc: &'a bson::Document, path: &str) -> Option<&'a bson::Bson> {
    let mut current = doc.get(path.split('.').next()?)?;
    for part in path.split('.').skip(1) {
        current = match current {
            bson::Bson::Document(map) => map.get(part)?,
            bson::Bson::Array(items) => items.get(part.parse::<usize>().ok()?)?,
            _ => return None,
        };
    }
    Some(current)
}

/// If `path` contains the `__unset__` marker, strip it and return the real element path.
/// e.g. "list.__unset__.2" → Some("list.2"), "list.0.name" → None
pub fn decode_unset_path(path: &str) -> Option<String> {
    path.find(UNSET_MARKER).map(|pos| {
        let prefix = &path[..pos];
        let index = &path[pos + UNSET_MARKER.len()..];
        format!("{}.{}", prefix, index)
    })
}

/// Encode an array path + index as an __unset__ marker path.
/// e.g. ("list", 2) → "list.__unset__.2"
pub fn encode_unset_path(array_path: &str, index: usize) -> String {
    format!("{}{}{}", array_path, UNSET_MARKER, index)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn get_nested_value_traverses_object() {
        let val = json!({ "a": { "b": 42 } });
        assert_eq!(get_nested_value(&val, "a.b"), Some(&json!(42)));
    }

    #[test]
    fn get_nested_value_traverses_array() {
        let val = json!({ "list": [{ "x": 7 }] });
        assert_eq!(get_nested_value(&val, "list.0.x"), Some(&json!(7)));
    }

    #[test]
    fn get_nested_value_returns_none_for_missing_path() {
        let val = json!({ "a": 1 });
        assert!(get_nested_value(&val, "a.b.c").is_none());
    }

    #[test]
    fn get_nested_bson_value_preserves_object_id() {
        let id = bson::oid::ObjectId::new();
        let doc = bson::doc! { "nested": { "id": id } };
        assert_eq!(
            get_nested_bson_value(&doc, "nested.id"),
            doc.get_document("nested")
                .ok()
                .and_then(|nested| nested.get("id"))
        );
    }

    #[test]
    fn decode_unset_path_handles_marker() {
        assert_eq!(
            decode_unset_path("list_define.__unset__.3"),
            Some("list_define.3".to_string())
        );
        assert_eq!(
            decode_unset_path("a.b.arr.__unset__.2"),
            Some("a.b.arr.2".to_string())
        );
    }

    #[test]
    fn decode_unset_path_passes_through_normal_path() {
        assert_eq!(decode_unset_path("list_define.0.option.scale_min"), None);
    }

    #[test]
    fn encode_unset_path_format() {
        assert_eq!(encode_unset_path("items", 2), "items.__unset__.2");
        assert_eq!(encode_unset_path("a.b.arr", 0), "a.b.arr.__unset__.0");
    }
}
