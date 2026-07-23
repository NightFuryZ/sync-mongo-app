use crate::models::{DiffKind, DiffRecord, DiffScopeStats, DiffSummary, SelectedDiffSummary};
use anyhow::Result;
use rusqlite::{params, Connection};

pub fn open_db(path: &str) -> Result<Connection> {
    let conn = Connection::open(path)?;
    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;")?;
    create_schema(&conn)?;
    Ok(conn)
}

pub fn create_schema(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS diff_records (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            collection    TEXT NOT NULL,
            kind          TEXT NOT NULL,
            key_value     TEXT NOT NULL,
            source_doc    TEXT NOT NULL DEFAULT '',
            target_doc    TEXT NOT NULL DEFAULT '',
            changed_fields TEXT NOT NULL DEFAULT '[]',
            selected      INTEGER NOT NULL DEFAULT 1,
            target_id     TEXT NOT NULL DEFAULT '',
            ref_labels    TEXT NOT NULL DEFAULT '{}'
        );
        CREATE INDEX IF NOT EXISTS idx_diff_collection ON diff_records(collection);
        CREATE INDEX IF NOT EXISTS idx_diff_kind ON diff_records(kind);",
    )?;

    // Migration: add ref_labels if missing (safe for existing DBs, idempotent)
    let col_exists: bool = conn
        .query_row(
            "SELECT COUNT(*) FROM pragma_table_info('diff_records') WHERE name = 'ref_labels'",
            [],
            |row| row.get::<_, i32>(0),
        )
        .unwrap_or(0)
        > 0;

    if !col_exists {
        conn.execute_batch(
            "ALTER TABLE diff_records ADD COLUMN ref_labels TEXT NOT NULL DEFAULT '{}';",
        )?;
    }

    Ok(())
}

pub fn clear_collection(conn: &Connection, collection: &str) -> Result<()> {
    conn.execute(
        "DELETE FROM diff_records WHERE collection = ?1",
        params![collection],
    )?;
    Ok(())
}

#[allow(clippy::too_many_arguments)] // One-to-one mapping to the diff_records SQL columns.
pub fn insert_diff(
    conn: &Connection,
    collection: &str,
    kind: &DiffKind,
    key_value: &str,
    source_doc: &str,
    target_doc: &str,
    changed_fields: &str,
    target_id: &str,
    ref_labels: &str,
) -> Result<i64> {
    let kind_str = match kind {
        DiffKind::Added => "added",
        DiffKind::Modified => "modified",
        DiffKind::Deleted => "deleted",
    };
    conn.execute(
        "INSERT INTO diff_records (collection, kind, key_value, source_doc, target_doc, changed_fields, target_id, ref_labels)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![collection, kind_str, key_value, source_doc, target_doc, changed_fields, target_id, ref_labels],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn query_diff_records(
    conn: &Connection,
    collection: &str,
    kind: &str,
    selected_only: bool,
    offset: i64,
    limit: i64,
) -> Result<Vec<DiffRecord>> {
    let sel_filter = if selected_only {
        "AND selected = 1"
    } else {
        ""
    };

    let map_row = |row: &rusqlite::Row| {
        let kind_str: String = row.get(2)?;
        let kind = match kind_str.as_str() {
            "added" => DiffKind::Added,
            "modified" => DiffKind::Modified,
            _ => DiffKind::Deleted,
        };
        Ok(DiffRecord {
            id: row.get(0)?,
            collection: row.get(1)?,
            kind,
            key_value: row.get(3)?,
            source_doc: row.get(4)?,
            target_doc: row.get(5)?,
            changed_fields: row.get(6)?,
            selected: row.get::<_, i32>(7)? != 0,
            target_id: row.get(8)?,
            ref_labels: row.get(9)?,
        })
    };

    if kind == "all" {
        let sql = format!(
            "SELECT id, collection, kind, key_value, source_doc, target_doc, changed_fields, selected, target_id, ref_labels
             FROM diff_records
             WHERE collection = ?1 {}
             ORDER BY id LIMIT ?2 OFFSET ?3",
            sel_filter
        );
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt
            .query_map(params![collection, limit, offset], map_row)?
            .map(|r| r.map_err(|e| anyhow::anyhow!(e)))
            .collect::<Result<Vec<_>>>()?;
        Ok(rows)
    } else {
        let sql = format!(
            "SELECT id, collection, kind, key_value, source_doc, target_doc, changed_fields, selected, target_id, ref_labels
             FROM diff_records
             WHERE collection = ?1 AND kind = ?2 {}
             ORDER BY id LIMIT ?3 OFFSET ?4",
            sel_filter
        );
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt
            .query_map(params![collection, kind, limit, offset], map_row)?
            .map(|r| r.map_err(|e| anyhow::anyhow!(e)))
            .collect::<Result<Vec<_>>>()?;
        Ok(rows)
    }
}

pub fn get_summary(conn: &Connection, collection: &str) -> Result<DiffSummary> {
    let added: u64 = conn.query_row(
        "SELECT COUNT(*) FROM diff_records WHERE collection=?1 AND kind='added'",
        params![collection],
        |r| r.get(0),
    )?;
    let modified: u64 = conn.query_row(
        "SELECT COUNT(*) FROM diff_records WHERE collection=?1 AND kind='modified'",
        params![collection],
        |r| r.get(0),
    )?;
    let deleted: u64 = conn.query_row(
        "SELECT COUNT(*) FROM diff_records WHERE collection=?1 AND kind='deleted'",
        params![collection],
        |r| r.get(0),
    )?;
    Ok(DiffSummary {
        collection: collection.to_string(),
        added,
        modified,
        deleted,
        total_processed: added + modified + deleted,
        total_estimated: 0,
    })
}

pub fn set_selected(conn: &Connection, ids: &[i64], selected: bool) -> Result<()> {
    let val: i32 = if selected { 1 } else { 0 };
    for id in ids {
        conn.execute(
            "UPDATE diff_records SET selected=?1 WHERE id=?2",
            params![val, id],
        )?;
    }
    Ok(())
}

pub fn set_all_selected(
    conn: &Connection,
    collection: &str,
    kind: &str,
    selected: bool,
) -> Result<()> {
    let val: i32 = if selected { 1 } else { 0 };
    if kind == "all" {
        conn.execute(
            "UPDATE diff_records SET selected=?1 WHERE collection=?2",
            params![val, collection],
        )?;
    } else {
        conn.execute(
            "UPDATE diff_records SET selected=?1 WHERE collection=?2 AND kind=?3",
            params![val, collection, kind],
        )?;
    }
    Ok(())
}

pub fn get_scope_stats(
    conn: &Connection,
    collection: &str,
    kind: &str,
    offset: i64,
    limit: i64,
) -> Result<DiffScopeStats> {
    // Count total records matching the filter
    let total_count: u64 = if kind == "all" {
        conn.query_row(
            "SELECT COUNT(*) FROM diff_records WHERE collection = ?1",
            params![collection],
            |r| r.get(0),
        )?
    } else {
        conn.query_row(
            "SELECT COUNT(*) FROM diff_records WHERE collection = ?1 AND kind = ?2",
            params![collection, kind],
            |r| r.get(0),
        )?
    };

    // Count selected records in the entire scope (not just the loaded page)
    let selected_count: u64 = if kind == "all" {
        conn.query_row(
            "SELECT COUNT(*) FROM diff_records WHERE collection = ?1 AND selected = 1",
            params![collection],
            |r| r.get(0),
        )?
    } else {
        conn.query_row(
            "SELECT COUNT(*) FROM diff_records WHERE collection = ?1 AND kind = ?2 AND selected = 1",
            params![collection, kind],
            |r| r.get(0),
        )?
    };

    // Loaded count is the minimum of limit and remaining records
    let loaded_count = std::cmp::min(limit as u64, total_count.saturating_sub(offset as u64));

    // has_more is true if there are records beyond the current page
    let has_more = (offset as u64 + loaded_count) < total_count;

    Ok(DiffScopeStats {
        collection: collection.to_string(),
        kind: kind.to_string(),
        loaded_count,
        selected_count,
        total_count,
        has_more,
    })
}

/// Get the total count of selected records across all collections.
/// Used to determine if the "Generate Script" button should be enabled.
pub fn get_global_selected_count(conn: &Connection) -> Result<u64> {
    let count: u64 = conn.query_row(
        "SELECT COUNT(*) FROM diff_records WHERE selected = 1",
        [],
        |r| r.get(0),
    )?;
    Ok(count)
}

/// Get selected operation counts per kind for a specific collection.
/// Used to show pre-execution summary before sync runs.
pub fn get_selected_diff_summary(
    conn: &Connection,
    collection: &str,
) -> Result<SelectedDiffSummary> {
    let added: u64 = conn.query_row(
        "SELECT COUNT(*) FROM diff_records WHERE collection=?1 AND kind='added' AND selected=1",
        params![collection],
        |r| r.get(0),
    )?;
    let modified: u64 = conn.query_row(
        "SELECT COUNT(*) FROM diff_records WHERE collection=?1 AND kind='modified' AND selected=1",
        params![collection],
        |r| r.get(0),
    )?;
    let deleted: u64 = conn.query_row(
        "SELECT COUNT(*) FROM diff_records WHERE collection=?1 AND kind='deleted' AND selected=1",
        params![collection],
        |r| r.get(0),
    )?;
    Ok(SelectedDiffSummary {
        collection: collection.to_string(),
        added,
        modified,
        deleted,
        total_selected: added + modified + deleted,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn in_memory_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        create_schema(&conn).unwrap();
        conn
    }

    #[test]
    fn insert_and_query() {
        let conn = in_memory_db();
        insert_diff(
            &conn,
            "users",
            &DiffKind::Added,
            r#"{"$oid":"abc"}"#,
            r#"{"name":"A"}"#,
            "",
            "[]",
            "",
            "{}",
        )
        .unwrap();
        insert_diff(
            &conn,
            "users",
            &DiffKind::Modified,
            r#"{"$oid":"xyz"}"#,
            r#"{"name":"B"}"#,
            r#"{"name":"C"}"#,
            r#"["name"]"#,
            "",
            "{}",
        )
        .unwrap();

        let added = query_diff_records(&conn, "users", "added", false, 0, 100).unwrap();
        assert_eq!(added.len(), 1);
        assert_eq!(added[0].key_value, r#"{"$oid":"abc"}"#);

        let all = query_diff_records(&conn, "users", "all", false, 0, 100).unwrap();
        assert_eq!(all.len(), 2);
    }

    #[test]
    fn summary_counts() {
        let conn = in_memory_db();
        insert_diff(
            &conn,
            "products",
            &DiffKind::Added,
            "k1",
            "",
            "",
            "[]",
            "",
            "{}",
        )
        .unwrap();
        insert_diff(
            &conn,
            "products",
            &DiffKind::Added,
            "k2",
            "",
            "",
            "[]",
            "",
            "{}",
        )
        .unwrap();
        insert_diff(
            &conn,
            "products",
            &DiffKind::Deleted,
            "k3",
            "",
            "",
            "[]",
            "",
            "{}",
        )
        .unwrap();
        let s = get_summary(&conn, "products").unwrap();
        assert_eq!(s.added, 2);
        assert_eq!(s.deleted, 1);
        assert_eq!(s.modified, 0);
    }

    #[test]
    fn selection_toggle() {
        let conn = in_memory_db();
        let id = insert_diff(&conn, "col", &DiffKind::Added, "k1", "", "", "[]", "", "{}").unwrap();
        set_selected(&conn, &[id], false).unwrap();
        let selected_only = query_diff_records(&conn, "col", "all", true, 0, 100).unwrap();
        assert_eq!(selected_only.len(), 0);
        set_selected(&conn, &[id], true).unwrap();
        let selected_only = query_diff_records(&conn, "col", "all", true, 0, 100).unwrap();
        assert_eq!(selected_only.len(), 1);
    }

    #[test]
    fn clear_collection_removes_only_that_collection() {
        let conn = in_memory_db();
        insert_diff(
            &conn,
            "col_a",
            &DiffKind::Added,
            "k1",
            "",
            "",
            "[]",
            "",
            "{}",
        )
        .unwrap();
        insert_diff(
            &conn,
            "col_b",
            &DiffKind::Added,
            "k2",
            "",
            "",
            "[]",
            "",
            "{}",
        )
        .unwrap();
        clear_collection(&conn, "col_a").unwrap();
        let a = query_diff_records(&conn, "col_a", "all", false, 0, 100).unwrap();
        let b = query_diff_records(&conn, "col_b", "all", false, 0, 100).unwrap();
        assert_eq!(a.len(), 0);
        assert_eq!(b.len(), 1);
    }

    #[test]
    fn pagination_works() {
        let conn = in_memory_db();
        for i in 0..10 {
            insert_diff(
                &conn,
                "paged",
                &DiffKind::Added,
                &format!("k{}", i),
                "",
                "",
                "[]",
                "",
                "{}",
            )
            .unwrap();
        }
        let page1 = query_diff_records(&conn, "paged", "all", false, 0, 3).unwrap();
        let page2 = query_diff_records(&conn, "paged", "all", false, 3, 3).unwrap();
        assert_eq!(page1.len(), 3);
        assert_eq!(page2.len(), 3);
        assert_ne!(page1[0].id, page2[0].id);
    }

    #[test]
    fn scope_stats_report_loaded_selected_and_total_counts() {
        let conn = in_memory_db();
        for i in 0..5 {
            insert_diff(
                &conn,
                "users",
                &DiffKind::Added,
                &format!("k{}", i),
                "",
                "",
                "[]",
                "",
                "{}",
            )
            .unwrap();
        }
        let ids = query_diff_records(&conn, "users", "all", false, 0, 5)
            .unwrap()
            .into_iter()
            .take(2)
            .map(|r| r.id)
            .collect::<Vec<_>>();
        set_selected(&conn, &ids, false).unwrap();

        let stats = get_scope_stats(&conn, "users", "all", 0, 3).unwrap();
        assert_eq!(stats.loaded_count, 3);
        assert_eq!(stats.total_count, 5);
        assert_eq!(stats.selected_count, 3);
        assert!(stats.has_more);
    }

    #[test]
    fn selected_diff_summary_counts_per_kind() {
        let conn = in_memory_db();
        insert_diff(
            &conn,
            "products",
            &DiffKind::Added,
            "k1",
            "",
            "",
            "[]",
            "",
            "{}",
        )
        .unwrap();
        insert_diff(
            &conn,
            "products",
            &DiffKind::Added,
            "k2",
            "",
            "",
            "[]",
            "",
            "{}",
        )
        .unwrap();
        insert_diff(
            &conn,
            "products",
            &DiffKind::Modified,
            "k3",
            "",
            "",
            "[]",
            "",
            "{}",
        )
        .unwrap();
        insert_diff(
            &conn,
            "products",
            &DiffKind::Deleted,
            "k4",
            "",
            "",
            "[]",
            "",
            "{}",
        )
        .unwrap();
        insert_diff(
            &conn,
            "products",
            &DiffKind::Deleted,
            "k5",
            "",
            "",
            "[]",
            "",
            "{}",
        )
        .unwrap();

        // Deselect one added and one deleted
        let records = query_diff_records(&conn, "products", "all", false, 0, 10).unwrap();
        set_selected(&conn, &[records[0].id, records[3].id], false).unwrap();

        let summary = get_selected_diff_summary(&conn, "products").unwrap();
        assert_eq!(summary.collection, "products");
        assert_eq!(summary.added, 1);
        assert_eq!(summary.modified, 1);
        assert_eq!(summary.deleted, 1);
        assert_eq!(summary.total_selected, 3);
    }
}
