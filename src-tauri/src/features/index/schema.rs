//! SQLite schema for the persistent search index.
//!
//! Split from the command layer so the migration logic can be tested against an
//! in-memory database — the part that actually needs proving is the **derived
//! data invalidation**, not the Tauri plumbing.
//!
//! Design note (the one thing worth reading twice): `PRAGMA user_version` holds
//! the version of the **parsing rules** that produced this data, not the schema
//! version. Incremental sync skips notes whose mtime/size are unchanged, so a
//! change to how tags/links/titles are parsed would otherwise leave every
//! untouched note carrying results produced by the old rules — silently, with
//! no error to notice. Bumping `PARSE_RULES_VERSION` therefore drops the whole
//! derived store and the next backfill re-parses the vault once.

use rusqlite::Connection;
use std::path::Path;

/// Bump whenever the frontend's extraction of title/tags/links changes meaning.
/// Every stored derivation becomes suspect at that moment, so the store is
/// rebuilt rather than patched (see the module note).
pub const PARSE_RULES_VERSION: i64 = 2;

const CREATE_SQL: &str = r#"
CREATE TABLE IF NOT EXISTS notes (
  path  TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '',
  mtime INTEGER NOT NULL DEFAULT 0,
  size  INTEGER NOT NULL DEFAULT 0,
  -- Full NoteMetadata as JSON. Keeping only title/body/tags/links would still
  -- force a warm start to read every file (reads are ~69% of boot cost on a
  -- 415-file vault), so the parsed result is stored whole.
  meta_json TEXT NOT NULL DEFAULT ''
);
CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
  path UNINDEXED,
  title,
  body,
  tokenize = 'unicode61 remove_diacritics 2'
);
CREATE TABLE IF NOT EXISTS outlinks (
  source TEXT NOT NULL,
  target TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_outlinks_target ON outlinks(target);
CREATE TABLE IF NOT EXISTS note_tags (
  path TEXT NOT NULL,
  tag  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_note_tags_tag ON note_tags(tag);
"#;

const DROP_SQL: &str = r#"
DROP TABLE IF EXISTS notes_fts;
DROP TABLE IF EXISTS notes;
DROP TABLE IF EXISTS outlinks;
DROP TABLE IF EXISTS note_tags;
"#;

/// Open (creating if needed) the index database at `path`, then bring it to
/// `PARSE_RULES_VERSION`. A database written by different parsing rules is
/// discarded, not migrated — the rows cannot be repaired without re-parsing.
pub fn open(path: &Path) -> rusqlite::Result<Connection> {
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let mut conn = Connection::open(path)?;
    // WAL keeps readers (search) from blocking the writer (watch-driven upserts).
    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;")?;
    migrate(&mut conn)?;
    Ok(conn)
}

/// Bring an open connection to the current parsing rules. Public for tests.
pub fn migrate(conn: &mut Connection) -> rusqlite::Result<()> {
    let stored = stored_rules_version(conn)?;
    if stored != PARSE_RULES_VERSION && table_exists(conn, "notes") {
        let tx = conn.transaction()?;
        tx.execute_batch(DROP_SQL)?;
        tx.commit()?;
    }
    conn.execute_batch(CREATE_SQL)?;
    if stored != PARSE_RULES_VERSION {
        conn.pragma_update(None, "user_version", PARSE_RULES_VERSION)?;
    }
    Ok(())
}

pub fn stored_rules_version(conn: &Connection) -> rusqlite::Result<i64> {
    conn.query_row("PRAGMA user_version", [], |row| row.get(0))
}

fn table_exists(conn: &Connection, name: &str) -> bool {
    conn.query_row(
        "SELECT 1 FROM sqlite_master WHERE type IN ('table','view') AND name = ?1",
        [name],
        |_| Ok(()),
    )
    .is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fresh() -> Connection {
        let mut conn = Connection::open_in_memory().expect("mem db");
        migrate(&mut conn).expect("migrate");
        conn
    }

    #[test]
    fn fresh_database_is_empty_and_stamped() {
        let conn = fresh();
        let notes: i64 = conn
            .query_row("SELECT count(*) FROM notes", [], |r| r.get(0))
            .unwrap();
        assert_eq!(notes, 0);
        assert_eq!(
            stored_rules_version(&conn).unwrap(),
            PARSE_RULES_VERSION,
            "a new index must record which rules produced it"
        );
    }

    #[test]
    fn re_migrating_the_same_version_is_a_no_op() {
        let mut conn = fresh();
        conn.execute(
            "INSERT INTO notes (path, title) VALUES ('a.md', 'A')",
            [],
        )
        .unwrap();
        migrate(&mut conn).unwrap(); // same version → must not wipe
        let notes: i64 = conn
            .query_row("SELECT count(*) FROM notes", [], |r| r.get(0))
            .unwrap();
        assert_eq!(notes, 1, "same-version migrate must keep the data");
    }

    #[test]
    fn newer_parse_rules_discard_every_derivation() {
        let mut conn = fresh();
        conn.execute_batch(
            "INSERT INTO notes (path, title) VALUES ('a.md', 'A');
             INSERT INTO notes_fts (path, title, body) VALUES ('a.md', 'A', 'body');
             INSERT INTO outlinks (source, target) VALUES ('a.md', 'b.md');
             INSERT INTO note_tags (path, tag) VALUES ('a.md', 'x');",
        )
        .unwrap();

        // Simulate a database written by earlier parsing rules.
        conn.pragma_update(None, "user_version", PARSE_RULES_VERSION - 1)
            .unwrap();
        migrate(&mut conn).unwrap();

        for table in ["notes", "notes_fts", "outlinks", "note_tags"] {
            let n: i64 = conn
                .query_row(&format!("SELECT count(*) FROM {table}"), [], |r| r.get(0))
                .unwrap();
            assert_eq!(n, 0, "{table} must be empty after a rules bump");
        }
        assert_eq!(stored_rules_version(&conn).unwrap(), PARSE_RULES_VERSION);
    }
}
