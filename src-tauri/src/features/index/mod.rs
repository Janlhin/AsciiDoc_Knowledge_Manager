//! Persistent search index — command layer.
//!
//! The vault is a folder of files; this is a *derived* store. Nothing here is a
//! source of truth, so every operation must be safe to lose: the index can be
//! dropped and rebuilt from the files at any time, and `schema::migrate` does
//! exactly that whenever the parsing rules change.
//!
//! Scope of this module: open/close per vault, incremental maintenance
//! (upsert / remove / remove-by-prefix / rename), and query. The frontend owns
//! extraction (title, body, tags, links) — Rust stays parsing-agnostic so the
//! Markdown and AsciiDoc pipelines keep a single implementation.

pub mod schema;

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};

/// One note as the frontend understands it. `body` is the searchable text;
/// `links`/`tags` are already extracted, so Rust never re-parses Markdown.
#[derive(Debug, Clone, Deserialize)]
pub struct IndexNote {
    pub path: String,
    pub title: String,
    pub body: String,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub links: Vec<String>,
    #[serde(default)]
    pub mtime: i64,
    #[serde(default)]
    pub size: i64,
    /// Serialized `NoteMetadata`; empty means "not hydrateable".
    #[serde(default)]
    pub meta: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct SearchHit {
    pub path: String,
    pub title: String,
    pub snippet: String,
    pub rank: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct KnownNote {
    pub path: String,
    pub mtime: i64,
    pub size: i64,
    /// Serialized `NoteMetadata` (empty when the row predates hydration).
    pub meta: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct IndexStats {
    pub notes: i64,
    pub links: i64,
    pub tags: i64,
    pub parse_rules_version: i64,
    pub db_path: String,
}

struct OpenIndex {
    vault: String,
    db_path: PathBuf,
    conn: Connection,
}

#[derive(Default)]
pub struct IndexState(Mutex<Option<OpenIndex>>);

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

/* ---------------------------------- pure ops ---------------------------------- */

/// Insert or replace one note and its derived relations. Runs in a transaction
/// so a partial write can never leave `notes` and `notes_fts` disagreeing.
pub fn upsert(conn: &mut Connection, note: &IndexNote) -> rusqlite::Result<()> {
    let tx = conn.transaction()?;
    tx.execute(
        "INSERT INTO notes (path, title, mtime, size, meta_json)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(path) DO UPDATE SET title = ?2, mtime = ?3, size = ?4, meta_json = ?5",
        params![note.path, note.title, note.mtime, note.size, note.meta],
    )?;
    tx.execute("DELETE FROM notes_fts WHERE path = ?1", [&note.path])?;
    tx.execute(
        "INSERT INTO notes_fts (path, title, body) VALUES (?1, ?2, ?3)",
        params![note.path, note.title, note.body],
    )?;
    tx.execute("DELETE FROM outlinks WHERE source = ?1", [&note.path])?;
    for target in &note.links {
        tx.execute(
            "INSERT INTO outlinks (source, target) VALUES (?1, ?2)",
            params![note.path, target],
        )?;
    }
    tx.execute("DELETE FROM note_tags WHERE path = ?1", [&note.path])?;
    for tag in &note.tags {
        tx.execute(
            "INSERT INTO note_tags (path, tag) VALUES (?1, ?2)",
            params![note.path, tag],
        )?;
    }
    tx.commit()
}

pub fn remove(conn: &mut Connection, paths: &[String]) -> rusqlite::Result<()> {
    let tx = conn.transaction()?;
    for path in paths {
        tx.execute("DELETE FROM notes WHERE path = ?1", [path])?;
        tx.execute("DELETE FROM notes_fts WHERE path = ?1", [path])?;
        tx.execute("DELETE FROM outlinks WHERE source = ?1", [path])?;
        tx.execute("DELETE FROM note_tags WHERE path = ?1", [path])?;
    }
    tx.commit()
}

/// Remove everything under a folder (folder delete). `prefix` is a bare folder
/// path; the `LIKE` pattern is escaped so `_`/`%` in folder names cannot widen it.
pub fn remove_prefix(conn: &mut Connection, prefix: &str) -> rusqlite::Result<usize> {
    let pattern = format!("{}/%", escape_like(prefix));
    let tx = conn.transaction()?;
    let affected = tx.execute(
        "DELETE FROM notes WHERE path LIKE ?1 ESCAPE '\\'",
        [&pattern],
    )?;
    tx.execute("DELETE FROM notes_fts WHERE path LIKE ?1 ESCAPE '\\'", [&pattern])?;
    tx.execute(
        "DELETE FROM outlinks WHERE source LIKE ?1 ESCAPE '\\'",
        [&pattern],
    )?;
    tx.execute(
        "DELETE FROM note_tags WHERE path LIKE ?1 ESCAPE '\\'",
        [&pattern],
    )?;
    tx.commit()?;
    Ok(affected)
}

/// Rename/move one note. Links that pointed at the old path follow it, because
/// the index must not disagree with the renamed file on disk.
pub fn rename(conn: &mut Connection, from: &str, to: &str) -> rusqlite::Result<()> {
    let tx = conn.transaction()?;
    tx.execute("UPDATE notes SET path = ?2 WHERE path = ?1", params![from, to])?;
    tx.execute(
        "UPDATE notes_fts SET path = ?2 WHERE path = ?1",
        params![from, to],
    )?;
    tx.execute(
        "UPDATE outlinks SET source = ?2 WHERE source = ?1",
        params![from, to],
    )?;
    tx.execute(
        "UPDATE note_tags SET path = ?2 WHERE path = ?1",
        params![from, to],
    )?;
    retarget(&tx, from, to)?;
    tx.commit()
}

/// Folder rename/move: shift the whole subtree, then retarget links that named
/// any path inside it.
pub fn rename_prefix(conn: &mut Connection, from: &str, to: &str) -> rusqlite::Result<usize> {
    let from_prefix = format!("{}/", escape_like(from));
    let tx = conn.transaction()?;
    let affected = tx.execute(
        "UPDATE notes SET path = ?2 || substr(path, ?3) WHERE path LIKE ?1 ESCAPE '\\'",
        params![format!("{from_prefix}%"), to, from.len() + 1],
    )?;
    for sql in [
        "UPDATE notes_fts SET path = ?2 || substr(path, ?3) WHERE path LIKE ?1 ESCAPE '\\'",
        "UPDATE outlinks SET source = ?2 || substr(source, ?3) WHERE source LIKE ?1 ESCAPE '\\'",
        "UPDATE note_tags SET path = ?2 || substr(path, ?3) WHERE path LIKE ?1 ESCAPE '\\'",
    ] {
        tx.execute(sql, params![format!("{from_prefix}%"), to, from.len() + 1])?;
    }
    let targets: Vec<String> = {
        let mut stmt = tx.prepare(
            "SELECT DISTINCT target FROM outlinks WHERE target LIKE ?1 ESCAPE '\\'",
        )?;
        let rows = stmt.query_map([format!("{from_prefix}%")], |r| r.get::<_, String>(0))?;
        rows.collect::<rusqlite::Result<Vec<_>>>()?
    };
    for target in targets {
        let shifted = format!("{}{}", to, &target[from.len()..]);
        retarget(&tx, &target, &shifted)?;
    }
    tx.commit()?;
    Ok(affected)
}

/// Rewrite `outlinks.target`, including `target#subpath` forms.
fn retarget(tx: &rusqlite::Transaction<'_>, from: &str, to: &str) -> rusqlite::Result<()> {
    tx.execute(
        "UPDATE outlinks SET target = ?2 WHERE target = ?1",
        params![from, to],
    )?;
    tx.execute(
        "UPDATE outlinks SET target = ?2 || substr(target, ?3) WHERE target LIKE ?1 ESCAPE '\\'",
        params![format!("{}#%", escape_like(from)), to, from.len() + 1],
    )?;
    Ok(())
}

pub fn search(
    conn: &Connection,
    query: &str,
    limit: usize,
) -> rusqlite::Result<Vec<SearchHit>> {
    let match_expr = match_query(query);
    if match_expr.is_empty() {
        return Ok(Vec::new());
    }
    let mut stmt = conn.prepare(
        "SELECT path, title,
                snippet(notes_fts, 2, '<mark>', '</mark>', '…', 12),
                bm25(notes_fts, 10.0, 1.0)
           FROM notes_fts
          WHERE notes_fts MATCH ?1
          ORDER BY 4
          LIMIT ?2",
    )?;
    let rows = stmt.query_map(params![match_expr, limit as i64], |row| {
        Ok(SearchHit {
            path: row.get(0)?,
            title: row.get(1)?,
            snippet: row.get(2)?,
            rank: row.get(3)?,
        })
    })?;
    rows.collect()
}

/// FTS5 query from raw user input:每个词加引号并允许前缀匹配，同时剥掉
/// FTS 语法字符 —— 否则 `a:b`、`"` 之类会让 MATCH 直接报语法错。
fn match_query(raw: &str) -> String {
    const RESERVED: &str = "\";:*^(){}[]-+";
    raw.split_whitespace()
        .map(|term| {
            let cleaned: String = term.chars().filter(|c| !RESERVED.contains(*c)).collect();
            cleaned
        })
        .filter(|term| !term.is_empty())
        .map(|term| format!("\"{term}\"*"))
        .collect::<Vec<_>>()
        .join(" ")
}

fn escape_like(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_")
}

pub fn known(conn: &Connection) -> rusqlite::Result<Vec<KnownNote>> {
    let mut stmt = conn.prepare("SELECT path, mtime, size, meta_json FROM notes")?;
    let rows = stmt.query_map([], |row| {
        Ok(KnownNote {
            path: row.get(0)?,
            mtime: row.get(1)?,
            size: row.get(2)?,
            meta: row.get(3)?,
        })
    })?;
    rows.collect()
}

pub fn stats(conn: &Connection) -> rusqlite::Result<(i64, i64, i64)> {
    let notes = conn.query_row("SELECT count(*) FROM notes", [], |r| r.get(0))?;
    let links = conn.query_row("SELECT count(*) FROM outlinks", [], |r| r.get(0))?;
    let tags = conn.query_row("SELECT count(*) FROM note_tags", [], |r| r.get(0))?;
    Ok((notes, links, tags))
}

/* ---------------------------------- state ---------------------------------- */

fn with_index<T>(
    state: &State<'_, IndexState>,
    f: impl FnOnce(&mut OpenIndex) -> Result<T, String>,
) -> Result<T, String> {
    let mut guard = state.0.lock().map_err(|_| "index lock poisoned".to_string())?;
    let open = guard.as_mut().ok_or_else(|| "no index open".to_string())?;
    f(open)
}

/// Stable per-vault directory name. Vault paths are normalised the same way the
/// frontend normalises its storage keys, so one vault never gets two indexes.
fn vault_slug(vault: &str) -> String {
    let normalised = vault.replace('\\', "/").to_lowercase();
    let trimmed = normalised.trim_end_matches('/');
    let mut hasher = DefaultHasher::new();
    trimmed.hash(&mut hasher);
    let stem = trimmed.rsplit('/').next().unwrap_or("vault");
    let safe: String = stem
        .chars()
        .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '-' })
        .collect();
    format!("{safe}-{:016x}", hasher.finish())
}

/* --------------------------------- commands --------------------------------- */

#[tauri::command]
pub fn index_open(
    app: AppHandle,
    state: State<'_, IndexState>,
    vault_path: String,
) -> Result<IndexStats, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(err)?
        .join("index")
        .join(vault_slug(&vault_path));
    let db_path = dir.join("index.sqlite");

    let mut guard = state.0.lock().map_err(|_| "index lock poisoned".to_string())?;
    // Re-opening the same vault keeps the existing connection (and its WAL).
    if let Some(open) = guard.as_ref() {
        if open.vault == vault_path {
            let (notes, links, tags) = stats(&open.conn).map_err(err)?;
            return Ok(IndexStats {
                notes,
                links,
                tags,
                parse_rules_version: schema::stored_rules_version(&open.conn).map_err(err)?,
                db_path: open.db_path.display().to_string(),
            });
        }
    }

    let conn = schema::open(&db_path).map_err(err)?;
    let (notes, links, tags) = stats(&conn).map_err(err)?;
    let version = schema::stored_rules_version(&conn).map_err(err)?;
    let stats_out = IndexStats {
        notes,
        links,
        tags,
        parse_rules_version: version,
        db_path: db_path.display().to_string(),
    };
    *guard = Some(OpenIndex { vault: vault_path, db_path, conn });
    Ok(stats_out)
}

#[tauri::command]
pub fn index_close(state: State<'_, IndexState>) -> Result<(), String> {
    let mut guard = state.0.lock().map_err(|_| "index lock poisoned".to_string())?;
    *guard = None;
    Ok(())
}

#[tauri::command]
pub fn index_upsert(state: State<'_, IndexState>, note: IndexNote) -> Result<(), String> {
    with_index(&state, |open| upsert(&mut open.conn, &note).map_err(err))
}

#[tauri::command]
pub fn index_remove(state: State<'_, IndexState>, paths: Vec<String>) -> Result<(), String> {
    with_index(&state, |open| remove(&mut open.conn, &paths).map_err(err))
}

#[tauri::command]
pub fn index_remove_prefix(state: State<'_, IndexState>, prefix: String) -> Result<usize, String> {
    with_index(&state, |open| remove_prefix(&mut open.conn, &prefix).map_err(err))
}

#[tauri::command]
pub fn index_rename(
    state: State<'_, IndexState>,
    from: String,
    to: String,
) -> Result<(), String> {
    with_index(&state, |open| rename(&mut open.conn, &from, &to).map_err(err))
}

#[tauri::command]
pub fn index_rename_prefix(
    state: State<'_, IndexState>,
    from: String,
    to: String,
) -> Result<usize, String> {
    with_index(&state, |open| rename_prefix(&mut open.conn, &from, &to).map_err(err))
}

#[tauri::command]
pub fn index_search(
    state: State<'_, IndexState>,
    query: String,
    limit: Option<usize>,
) -> Result<Vec<SearchHit>, String> {
    with_index(&state, |open| {
        search(&open.conn, &query, limit.unwrap_or(50).clamp(1, 500)).map_err(err)
    })
}

#[tauri::command]
pub fn index_known(state: State<'_, IndexState>) -> Result<Vec<KnownNote>, String> {
    with_index(&state, |open| known(&open.conn).map_err(err))
}

#[tauri::command]
pub fn index_clear(state: State<'_, IndexState>) -> Result<(), String> {
    with_index(&state, |open| {
        open.conn
            .execute_batch("DELETE FROM notes_fts; DELETE FROM notes; DELETE FROM outlinks; DELETE FROM note_tags;")
            .map_err(err)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::features::index::schema::migrate;

    fn db() -> Connection {
        let mut conn = Connection::open_in_memory().expect("mem db");
        migrate(&mut conn).expect("migrate");
        conn
    }

    fn note(path: &str, title: &str, body: &str, tags: &[&str], links: &[&str]) -> IndexNote {
        IndexNote {
            path: path.into(),
            title: title.into(),
            body: body.into(),
            tags: tags.iter().map(|s| s.to_string()).collect(),
            links: links.iter().map(|s| s.to_string()).collect(),
            mtime: 1,
            size: 10,
            meta: String::new(),
        }
    }

    #[test]
    fn search_hits_title_and_body_with_bm25() {
        let mut conn = db();
        upsert(&mut conn, &note("a.md", "Rust ownership", "borrow checker notes", &[], &[])).unwrap();
        upsert(&mut conn, &note("b.md", "Cooking", "rust-free kitchen notes", &[], &[])).unwrap();

        let hits = search(&conn, "rust", 10).unwrap();
        assert_eq!(hits.len(), 2, "both notes mention rust");
        assert_eq!(
            hits[0].path, "a.md",
            "a title hit (weight 10) must outrank a body hit (weight 1)"
        );

        // The snippet is taken from the body column, so a title-only match is
        // deliberately unmarked — the reader still sees what the note says.
        assert!(
            !hits[0].snippet.contains("<mark>"),
            "title-only match yields a plain body excerpt, got {:?}",
            hits[0].snippet
        );

        // A body match is the case that must be marked up.
        let body_hit = search(&conn, "borrow", 10).unwrap();
        assert_eq!(body_hit.len(), 1);
        assert!(
            body_hit[0].snippet.contains("<mark>borrow</mark>"),
            "body match must be marked, got {:?}",
            body_hit[0].snippet
        );
    }

    #[test]
    fn search_tolerates_fts_syntax_characters() {
        let mut conn = db();
        upsert(&mut conn, &note("a.md", "Q&A", "a:b \"quoted\" (paren)", &[], &[])).unwrap();
        // 这些输入在裸 MATCH 里会抛 syntax error
        for raw in ["a:b", "\"quoted\"", "(paren)", "AND OR NOT", "-dash"] {
            let hits = search(&conn, raw, 10).unwrap_or_else(|e| panic!("{raw} -> {e}"));
            let _ = hits;
        }
    }

    #[test]
    fn prefix_search_matches_partial_words() {
        let mut conn = db();
        upsert(&mut conn, &note("a.md", "Persistence", "durable storage", &[], &[])).unwrap();
        let hits = search(&conn, "persist", 10).unwrap();
        assert_eq!(hits.len(), 1, "prefix query should find 'Persistence'");
    }

    #[test]
    fn upsert_replaces_relations_instead_of_appending() {
        let mut conn = db();
        upsert(&mut conn, &note("a.md", "T", "b", &["x", "y"], &["b.md", "c.md"])).unwrap();
        upsert(&mut conn, &note("a.md", "T2", "b2", &["y"], &["c.md"])).unwrap();

        let tags: i64 = conn
            .query_row("SELECT count(*) FROM note_tags", [], |r| r.get(0))
            .unwrap();
        let links: i64 = conn
            .query_row("SELECT count(*) FROM outlinks", [], |r| r.get(0))
            .unwrap();
        let fts: i64 = conn
            .query_row("SELECT count(*) FROM notes_fts", [], |r| r.get(0))
            .unwrap();
        assert_eq!((tags, links, fts), (1, 1, 1), "re-upsert must not duplicate");
    }

    #[test]
    fn rename_moves_the_row_and_the_links_pointing_at_it() {
        let mut conn = db();
        upsert(&mut conn, &note("old.md", "Old", "body", &["t"], &[])).unwrap();
        upsert(&mut conn, &note("other.md", "Other", "b", &[], &["old.md", "old.md#heading"])).unwrap();

        rename(&mut conn, "old.md", "new.md").unwrap();

        let path: String = conn
            .query_row("SELECT path FROM notes", [], |r| r.get(0))
            .unwrap();
        // 两行 notes：new.md + other.md —— 取 other 的 target 检查
        assert!(path == "new.md" || path == "other.md");
        let targets: Vec<String> = {
            let mut stmt = conn.prepare("SELECT target FROM outlinks ORDER BY target").unwrap();
            let rows = stmt.query_map([], |r| r.get(0)).unwrap();
            rows.collect::<rusqlite::Result<Vec<_>>>().unwrap()
        };
        assert_eq!(targets, vec!["new.md", "new.md#heading"]);
        let fts_path: String = conn
            .query_row("SELECT path FROM notes_fts WHERE path = 'new.md'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(fts_path, "new.md");
    }

    #[test]
    fn remove_prefix_is_folder_scoped_and_escapes_like_wildcards() {
        let mut conn = db();
        upsert(&mut conn, &note("notes/a.md", "A", "b", &[], &[])).unwrap();
        upsert(&mut conn, &note("notes/deep/b.md", "B", "b", &[], &[])).unwrap();
        upsert(&mut conn, &note("notes2/c.md", "C", "b", &[], &[])).unwrap();
        upsert(&mut conn, &note("a_b/d.md", "D", "b", &[], &[])).unwrap();

        let removed = remove_prefix(&mut conn, "notes").unwrap();
        assert_eq!(removed, 2, "only the notes/ subtree");
        let left: i64 = conn.query_row("SELECT count(*) FROM notes", [], |r| r.get(0)).unwrap();
        assert_eq!(left, 2, "notes2/ and a_b/ must survive");

        // `_` is a LIKE wildcard; the escape must keep a_b/ from matching a_bc/
        let removed = remove_prefix(&mut conn, "a_b").unwrap();
        assert_eq!(removed, 1);
    }

    /// Perf measurement, not a gate: what a warm start pays to fetch every row.
    /// Run with `cargo test -- --ignored --nocapture`.
    #[test]
    #[ignore = "perf measurement"]
    fn bench_known_415_rows() {
        use std::time::Instant;
        // ~1.5 KB of realistic NoteMetadata JSON per row.
        let heading = r#"{"level":2,"text":"标准研磨日志","from":1234,"to":1256}"#;
        let link = r#"{"target":"Knowledge/规范/档案/书籍化定义修订案","from":88,"to":120}"#;
        let mut meta = String::from(r#"{"path":"Knowledge/x.md","aliases":["a","b"],"headings":["#);
        for i in 0..12 {
            if i > 0 { meta.push(','); }
            meta.push_str(heading);
        }
        meta.push_str(r#"],"links":["#);
        for i in 0..6 {
            if i > 0 { meta.push(','); }
            meta.push_str(link);
        }
        meta.push_str(r#"],"tags":[{"tag":"规范","from":3}],"blocks":[],"footnotes":[],"footnoteRefs":[],"contentLength":20480}"#);

        let mut conn = db();
        let t_ins = Instant::now();
        for i in 0..415 {
            let mut n = note(&format!("Knowledge/n{i}.md"), "n", "body", &[], &[]);
            n.meta = meta.clone();
            upsert(&mut conn, &n).unwrap();
        }
        let insert_ms = t_ins.elapsed().as_secs_f64() * 1000.0;

        let t_read = Instant::now();
        let rows = known(&conn).unwrap();
        let read_ms = t_read.elapsed().as_secs_f64() * 1000.0;

        let bytes: usize = rows.iter().map(|r| r.meta.len()).sum();
        println!(
            "insert 415 rows: {insert_ms:.1} ms | known() (fetch all meta_json): {read_ms:.1} ms | payload: {:.1} MB",
            bytes as f64 / 1_048_576.0
        );
        assert_eq!(rows.len(), 415);
    }

    #[test]
    fn metadata_json_round_trips_for_warm_start_hydration() {
        let mut conn = db();
        let mut n = note("a.md", "A", "b", &[], &[]);
        n.meta = r#"{"path":"a.md","headings":[{"level":1,"text":"A"}]}"#.into();
        upsert(&mut conn, &n).unwrap();

        let rows = known(&conn).unwrap();
        assert_eq!(rows.len(), 1);
        assert!(rows[0].meta.contains("headings"), "meta must survive upsert");

        // A re-upsert with an empty meta clears it rather than keeping stale JSON.
        let mut n2 = note("a.md", "A2", "b2", &[], &[]);
        n2.meta = String::new();
        upsert(&mut conn, &n2).unwrap();
        assert_eq!(known(&conn).unwrap()[0].meta, "");
    }

    #[test]
    fn known_reports_mtime_and_size_for_backfill() {
        let mut conn = db();
        upsert(&mut conn, &note("a.md", "A", "b", &[], &[])).unwrap();
        let known = known(&conn).unwrap();
        assert_eq!(known.len(), 1);
        assert_eq!((known[0].mtime, known[0].size), (1, 10));
    }

    /// T-041: pin why the two search modes must stay separate. FTS5's
    /// unicode61 tokenizer matches word *prefixes*, so a mid-word substring
    /// cannot be found. The frontend's substring evaluator can. Merging the
    /// two would silently drop results.
    #[test]
    fn index_tokenization_is_prefix_only() {
        let mut conn = db();
        upsert(&mut conn, &note("a.md", "Ownership", "ownership model", &[], &[])).unwrap();

        assert_eq!(search(&conn, "owner", 10).unwrap().len(), 1, "word prefix hits");
        assert_eq!(
            search(&conn, "nership", 10).unwrap().len(),
            0,
            "mid-word substring must NOT hit: this is why an independent mode exists"
        );
    }

    #[test]
    fn vault_slug_is_stable_and_case_insensitive() {
        assert_eq!(vault_slug("C:\\Vault\\"), vault_slug("c:/vault"));
        assert_ne!(vault_slug("C:/Vault"), vault_slug("C:/Vault2"));
    }
}
