//! App-owned base bytes; runtime/session context remains the engine's concern.
use crate::Result;
use std::io::Write;
use std::path::{Path, PathBuf};

#[cfg(test)]
const BASE: &str = include_str!("../instructions/base.md");

/// Publish once inside the controller's private per-launch directory. The
/// existing Running owner retains this directory until confirmed teardown.
pub(crate) fn materialize(directory: &Path, text: &str) -> Result<PathBuf> {
    if !directory.is_absolute() {
        return Err("Base instructions require an absolute runtime directory".into());
    }
    // Match ACP's whole-base file limit, in UTF-8 bytes.
    if text.len() > 1_048_576 || text.trim().is_empty() || text.contains('\0') {
        return Err(
            "App base instructions are empty, invalid or exceed the runtime size limit".into(),
        );
    }
    let path = directory.join("base-prompt.md");
    let mut file = tempfile::NamedTempFile::new_in(directory)
        .map_err(|_| "Could not prepare app base instructions")?;
    file.write_all(text.as_bytes())
        .map_err(|_| "Could not write app base instructions")?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        file.as_file()
            .set_permissions(std::fs::Permissions::from_mode(0o400))
            .map_err(|_| "Could not protect app base instructions")?;
    }
    file.as_file()
        .sync_all()
        .map_err(|_| "Could not sync app base instructions")?;
    file.persist_noclobber(&path)
        .map_err(|_| "Could not publish app base instructions; nothing was started")?;
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use sha2::{Digest, Sha256};
    use std::fs;

    #[test]
    fn initial_import_matches_recorded_source_bytes() {
        let source: serde_json::Value =
            serde_json::from_str(include_str!("../instructions/source.json")).unwrap();
        assert_eq!(source["repository"], "https://github.com/block/buzz");
        assert_eq!(
            source["revision"],
            "84b0fd04b7831657df2873c3a835412f47cebb03"
        );
        assert_eq!(source["path"], "crates/buzz-acp/src/base_prompt.md");
        assert_eq!(source["bytes"], BASE.len());
        assert_eq!(
            source["sha256"],
            format!("{:x}", Sha256::digest(BASE.as_bytes()))
        );
    }

    #[test]
    fn materialization_is_exact_and_never_overwrites_a_launch() {
        let directory = tempfile::tempdir().unwrap();
        let path = materialize(directory.path(), BASE).unwrap();
        assert!(path.is_absolute());
        assert!(fs::symlink_metadata(&path).unwrap().is_file());
        assert_eq!(fs::read(&path).unwrap(), BASE.as_bytes());
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(&path).unwrap().permissions().mode() & 0o777,
                0o400
            );
        }
        assert!(materialize(directory.path(), BASE).is_err());
        assert_eq!(fs::read(&path).unwrap(), BASE.as_bytes());
        assert_eq!(fs::read_dir(directory.path()).unwrap().count(), 1);
    }

    #[test]
    fn unavailable_directory_fails_without_fallback() {
        let directory = tempfile::tempdir().unwrap();
        assert!(materialize(&directory.path().join("missing"), BASE).is_err());
        assert!(materialize(Path::new("relative"), BASE).is_err());
        assert_eq!(fs::read_dir(directory.path()).unwrap().count(), 0);
    }

    #[test]
    #[cfg(unix)]
    fn existing_link_is_not_followed_or_replaced() {
        let directory = tempfile::tempdir().unwrap();
        let target = directory.path().join("untouched");
        fs::write(&target, "original").unwrap();
        let link = directory.path().join("base-prompt.md");
        std::os::unix::fs::symlink(&target, &link).unwrap();
        assert!(materialize(directory.path(), BASE).is_err());
        assert!(fs::symlink_metadata(&link)
            .unwrap()
            .file_type()
            .is_symlink());
        assert_eq!(fs::read_to_string(target).unwrap(), "original");
    }
}
