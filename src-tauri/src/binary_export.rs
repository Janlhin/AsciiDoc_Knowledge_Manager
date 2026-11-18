//! Owned chunked exports. No frontend-selected temporary paths.
use std::collections::HashMap;
use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

const CHUNK_LIMIT: usize = 4 * 1024 * 1024;
static NEXT: AtomicU64 = AtomicU64::new(1);

struct Session {
    path: PathBuf,
    temp: PathBuf,
    file: Option<File>,
    expected: u64,
    written: u64,
}
impl Drop for Session {
    fn drop(&mut self) {
        self.file.take(); // Windows cannot delete an open file.
        let _ = fs::remove_file(&self.temp);
    }
}

// Publish without replacing a destination created by another process.
#[cfg(windows)]
fn publish_new(from: &std::path::Path, to: &std::path::Path) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    #[link(name = "kernel32")]
    extern "system" {
        fn MoveFileExW(from: *const u16, to: *const u16, flags: u32) -> i32;
    }
    let from: Vec<u16> = from.as_os_str().encode_wide().chain(Some(0)).collect();
    let to: Vec<u16> = to.as_os_str().encode_wide().chain(Some(0)).collect();
    // SAFETY: buffers are NUL-terminated and live for this synchronous call.
    // WRITE_THROUGH only; deliberately omit REPLACE_EXISTING and COPY_ALLOWED.
    if unsafe { MoveFileExW(from.as_ptr(), to.as_ptr(), 0x8) } == 0 {
        Err(std::io::Error::last_os_error())
    } else {
        Ok(())
    }
}

#[cfg(not(windows))]
fn publish_new(from: &std::path::Path, to: &std::path::Path) -> std::io::Result<()> {
    // Same-directory hard link is atomic and fails if the destination exists.
    // Filesystems without hard-link support fail safely; never fall back to clobbering rename.
    fs::hard_link(from, to)
}

#[derive(Default)]
pub struct Exports {
    sessions: HashMap<String, Session>,
}

impl Exports {
    pub fn begin(&mut self, path: PathBuf, expected: u64) -> Result<String, String> {
        if !path.is_absolute() || path.file_name().is_none() {
            return Err("export requires an absolute file path".into());
        }
        if path.exists() {
            return Err("export destination already exists".into());
        }
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|e| e.to_string())?
            .as_nanos();
        let id = format!(
            "{}-{stamp}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        );
        let mut name = path.file_name().unwrap().to_os_string();
        name.push(format!(".{id}.geode-export.tmp"));
        let temp = path.with_file_name(name);
        let file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp)
            .map_err(|e| e.to_string())?;
        self.sessions.insert(
            id.clone(),
            Session {
                path,
                temp,
                file: Some(file),
                expected,
                written: 0,
            },
        );
        Ok(id)
    }

    pub fn append(&mut self, id: &str, bytes: &[u8]) -> Result<(), String> {
        let s = self.sessions.get_mut(id).ok_or("unknown export session")?;
        if bytes.len() > CHUNK_LIMIT || bytes.len() as u64 > s.expected.saturating_sub(s.written) {
            return Err("export chunk exceeds declared size or chunk limit".into());
        }
        s.file
            .as_mut()
            .ok_or("export file is closed")?
            .write_all(bytes)
            .map_err(|e| e.to_string())?;
        s.written += bytes.len() as u64;
        Ok(())
    }

    pub fn finish(&mut self, id: &str) -> Result<(), String> {
        let mut s = self.sessions.remove(id).ok_or("unknown export session")?;
        if s.written != s.expected {
            return Err("incomplete export".into());
        }
        let file = s.file.take().ok_or("export file is closed")?;
        if file.metadata().map_err(|e| e.to_string())?.len() != s.expected {
            return Err("export file length differs from declared size".into());
        }
        file.sync_all().map_err(|e| e.to_string())?;
        drop(file);
        // Friendly early error; publish_new also rejects a racing destination.
        if s.path.exists() {
            return Err("export destination already exists".into());
        }
        publish_new(&s.temp, &s.path).map_err(|e| e.to_string())
    }

    pub fn abort(&mut self, id: &str) {
        self.sessions.remove(id); // Drop closes/deletes only this session's temp.
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    struct Dir(PathBuf);
    impl Dir {
        fn new() -> Self {
            let p = std::env::temp_dir().join(format!(
                "adkm-export-test-{}-{}",
                std::process::id(),
                NEXT.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir(&p).unwrap();
            Self(p)
        }
        fn path(&self, name: &str) -> PathBuf {
            self.0.join(name)
        }
    }
    impl Drop for Dir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn interleaved_exports_have_distinct_content() {
        let d = Dir::new();
        let mut e = Exports::default();
        let a = e.begin(d.path("a.zip"), 4).unwrap();
        let b = e.begin(d.path("b.zip"), 4).unwrap();
        e.append(&a, b"AA").unwrap();
        e.append(&b, b"BB").unwrap();
        e.append(&a, b"aa").unwrap();
        e.append(&b, b"bb").unwrap();
        e.finish(&b).unwrap();
        e.finish(&a).unwrap();
        assert_eq!(fs::read(d.path("a.zip")).unwrap(), b"AAaa");
        assert_eq!(fs::read(d.path("b.zip")).unwrap(), b"BBbb");
        assert_eq!(fs::read_dir(&d.0).unwrap().count(), 2);
    }

    #[test]
    fn same_destination_cannot_mix_sessions_or_replace_published_file() {
        let d = Dir::new();
        let mut e = Exports::default();
        let a = e.begin(d.path("same.zip"), 2).unwrap();
        let b = e.begin(d.path("same.zip"), 2).unwrap();
        e.append(&a, b"AA").unwrap();
        e.append(&b, b"BB").unwrap();
        e.finish(&a).unwrap();
        assert!(e.finish(&b).is_err());
        assert_eq!(fs::read(d.path("same.zip")).unwrap(), b"AA");
        assert_eq!(fs::read_dir(&d.0).unwrap().count(), 1);
    }

    #[test]
    fn racing_publishers_never_replace_the_winner() {
        let d = Dir::new();
        let barrier = std::sync::Arc::new(std::sync::Barrier::new(2));
        let mut threads = Vec::new();
        for data in [b"AA", b"BB"] {
            let path = d.path("same.zip");
            let barrier = barrier.clone();
            threads.push(std::thread::spawn(move || {
                let mut e = Exports::default();
                let id = e.begin(path, 2).unwrap();
                e.append(&id, data).unwrap();
                barrier.wait();
                e.finish(&id).is_ok()
            }));
        }
        let successes = threads
            .into_iter()
            .map(|t| t.join().unwrap())
            .filter(|ok| *ok)
            .count();
        assert_eq!(successes, 1);
        let bytes = fs::read(d.path("same.zip")).unwrap();
        assert!(bytes == b"AA" || bytes == b"BB");
        assert_eq!(fs::read_dir(&d.0).unwrap().count(), 1);
    }

    #[test]
    fn abort_does_not_touch_other_session_or_archive() {
        let d = Dir::new();
        let mut e = Exports::default();
        fs::write(d.path("old.zip"), b"old").unwrap();
        let a = e.begin(d.path("a.zip"), 2).unwrap();
        let b = e.begin(d.path("b.zip"), 2).unwrap();
        e.append(&a, b"A").unwrap();
        e.abort(&a);
        e.abort(&a);
        assert!(e.append(&a, b"A").is_err());
        e.append(&b, b"BB").unwrap();
        e.finish(&b).unwrap();
        assert_eq!(fs::read(d.path("old.zip")).unwrap(), b"old");
        assert_eq!(fs::read(d.path("b.zip")).unwrap(), b"BB");
        assert_eq!(fs::read_dir(&d.0).unwrap().count(), 2);
    }

    #[test]
    fn incomplete_finish_removes_own_temp_without_publishing() {
        let d = Dir::new();
        let mut e = Exports::default();
        let a = e.begin(d.path("a.zip"), 2).unwrap();
        e.append(&a, b"A").unwrap();
        assert!(e.finish(&a).is_err());
        assert_eq!(fs::read_dir(&d.0).unwrap().count(), 0);
    }

    #[test]
    fn actual_file_length_is_checked_not_only_successful_append_count() {
        let d = Dir::new();
        let mut e = Exports::default();
        let a = e.begin(d.path("a.zip"), 2).unwrap();
        e.append(&a, b"AA").unwrap();
        // Model bytes left by an unsuccessful partial write, absent from the counter.
        let temp = e.sessions.get(&a).unwrap().temp.clone();
        OpenOptions::new()
            .append(true)
            .open(temp)
            .unwrap()
            .write_all(b"extra")
            .unwrap();
        assert!(e.finish(&a).is_err());
        assert_eq!(fs::read_dir(&d.0).unwrap().count(), 0);
    }

    #[test]
    fn rejects_existing_files_and_oversized_chunks() {
        let d = Dir::new();
        let mut e = Exports::default();
        fs::write(d.path("old.zip"), b"old").unwrap();
        assert!(e.begin(d.path("old.zip"), 1).is_err());
        assert!(e.begin(PathBuf::from("relative.zip"), 1).is_err());
        let a = e.begin(d.path("a.zip"), 1).unwrap();
        assert!(e.append(&a, b"AA").is_err());
        assert!(e.append("unknown", b"A").is_err());
        e.abort(&a);
        assert_eq!(fs::read(d.path("old.zip")).unwrap(), b"old");
        assert_eq!(fs::read_dir(&d.0).unwrap().count(), 1);
    }
}
