use super::*;
use crate::config::{agent_id, HarnessEdit};
use serde_json::json;

pub(crate) fn fixture() -> Agent {
    let pubkey = "ab".repeat(32);
    let relay_url = "wss://relay.example".to_owned();
    Agent {
        picture: None,
        id: agent_id(&pubkey, &relay_url),
        pubkey,
        relay_url,
        name: "Test Brain".into(),
        system_prompt: "Take over the test world".into(),
        workspace: "/tmp".into(),
        harness: HarnessEdit {
            databricks: None,
            command: "buzz-agent".into(),
            args: vec![],
            model: "test-model".into(),
            provider: "test-provider".into(),
        },
        environment: BTreeMap::from([("TEST_TOKEN".into(), "secret-env-value".into())]),
        revision: 1,
        enabled: false,
        start_on_app_launch: None,
        credential_id: "test-credential".into(),
        auth_tag: Some("private-attestation".into()),
        imported: json!({"futureSetting": {"opaque": "preserve-me"}}),
        extra: BTreeMap::from([("futureTopLevel".into(), json!([1, 2, 3]))]),
    }
}
fn edit() -> AgentEdit {
    AgentEdit {
        picture: None,
        name: "Edited Brain".into(),
        system_prompt: "New prompt".into(),
        workspace: "/tmp".into(),
        harness: fixture().harness,
        environment: BTreeMap::new(),
    }
}
#[test]
fn snapshot_withholds_model_and_provider_environment_values() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = Store::open(dir.path().to_owned()).unwrap();
    let agent = |key: &str, command: &str, provider: &str, env: &[(&str, &str)]| {
        let mut agent = fixture();
        agent.pubkey = key.repeat(32);
        agent.id = agent_id(&agent.pubkey, &agent.relay_url);
        agent.harness.command = command.into();
        agent.harness.model.clear();
        agent.harness.provider = provider.into();
        agent.environment = env
            .iter()
            .map(|(k, v)| ((*k).into(), (*v).into()))
            .collect();
        agent
    };
    store
        .insert(vec![
            agent(
                "a1",
                "buzz-agent",
                "",
                &[
                    ("BUZZ_AGENT_MODEL", "synthetic-buzz-model"),
                    ("BUZZ_AGENT_PROVIDER", "synthetic-buzz-provider"),
                ],
            ),
            agent(
                "b2",
                "goose",
                "",
                &[
                    ("GOOSE_MODEL", "synthetic-goose-model"),
                    ("GOOSE_PROVIDER", "synthetic-goose-provider"),
                ],
            ),
            // A blank model on a Databricks provider falls back to this key.
            agent(
                "c3",
                "buzz-agent",
                "databricks",
                &[("DATABRICKS_MODEL", "synthetic-databricks-model")],
            ),
            // An empty override is still an override.
            agent("d4", "buzz-agent", "", &[("BUZZ_AGENT_PROVIDER", "")]),
            // A hidden provider decides a blank model before the Databricks fallback.
            agent(
                "e5",
                "buzz-agent",
                "databricks",
                &[
                    ("BUZZ_AGENT_PROVIDER", "synthetic-combined-provider"),
                    ("DATABRICKS_MODEL", "synthetic-combined-model"),
                ],
            ),
        ])
        .unwrap();
    let snapshot = store.snapshot().unwrap();
    let wire = serde_json::to_string(&snapshot).unwrap();
    for value in [
        "synthetic-buzz-model",
        "synthetic-buzz-provider",
        "synthetic-goose-model",
        "synthetic-goose-provider",
        "synthetic-databricks-model",
        "synthetic-combined-provider",
        "synthetic-combined-model",
    ] {
        assert!(!wire.contains(value), "projected {value}");
    }
    for (key, model, provider) in [
        ("a1", Some("BUZZ_AGENT_MODEL"), Some("BUZZ_AGENT_PROVIDER")),
        ("b2", Some("GOOSE_MODEL"), Some("GOOSE_PROVIDER")),
        ("c3", Some("DATABRICKS_MODEL"), None),
        (
            "d4",
            Some("BUZZ_AGENT_PROVIDER"),
            Some("BUZZ_AGENT_PROVIDER"),
        ),
        (
            "e5",
            Some("BUZZ_AGENT_PROVIDER"),
            Some("BUZZ_AGENT_PROVIDER"),
        ),
    ] {
        let view = snapshot
            .agents
            .iter()
            .find(|a| a.pubkey.starts_with(key))
            .unwrap();
        assert_eq!(
            (view.launch_model_env, view.launch_provider_env),
            (model, provider)
        );
        assert!(view.launch_model.is_none(), "{key} model value");
        assert_eq!(view.launch_provider.is_none(), provider.is_some(), "{key}");
    }
}
#[test]
fn real_store_save_cas_unknown_fields_secret_projection_and_reopen() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = Store::open(dir.path().to_owned()).unwrap();
    let agent = fixture();
    store.insert(vec![agent.clone()]).unwrap();
    store.save(&agent.id, 1, edit()).unwrap();
    let stale = store.save(&agent.id, 1, edit()).unwrap_err();
    assert!(stale.contains("Reload"));
    let view = serde_json::to_string(&store.snapshot().unwrap()).unwrap();
    for secret in [
        "secret-env-value",
        "private-attestation",
        "preserve-me",
        "test-credential",
        "futureTopLevel",
    ] {
        assert!(!view.contains(secret), "projected {secret}");
    }
    assert!(view.contains("TEST_TOKEN"));
    assert!(view.contains("Edited Brain"));
    assert_eq!(store.agents().unwrap()[0].revision, 2);
    let before = fs::read(store.path()).unwrap();
    assert!(Store::open(dir.path().to_owned()).is_err());
    drop(store);
    let store = Store::open(dir.path().to_owned()).unwrap();
    assert_eq!(fs::read(store.path()).unwrap(), before);
    let saved = &store.agents().unwrap()[0];
    assert_eq!(saved.environment, agent.environment);
    assert_eq!(saved.imported, agent.imported);
    assert_eq!(saved.extra, agent.extra);
    assert_eq!(saved.auth_tag, agent.auth_tag);
    assert_eq!(saved.credential_id, agent.credential_id);
    let backup: Value =
        serde_json::from_slice(&fs::read(dir.path().join("agents.previous.json")).unwrap())
            .unwrap();
    assert_eq!(backup["agents"][0]["revision"], 1);
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(
            fs::metadata(store.path()).unwrap().permissions().mode() & 0o777,
            0o600
        );
    }
}
#[test]
fn remove_requires_current_revision_and_persists_absence() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = Store::open(dir.path().to_owned()).unwrap();
    let agent = fixture();
    store.insert(vec![agent.clone()]).unwrap();
    store.enabled(&agent.id, false).unwrap();
    assert!(dir.path().join("agents.previous.json").exists());
    assert!(store.remove(&agent.id, agent.revision + 1).is_err());
    assert_eq!(store.agents().unwrap().len(), 1);
    store.remove(&agent.id, agent.revision).unwrap();
    assert!(store.agents().unwrap().is_empty());
    assert!(!dir.path().join("agents.previous.json").exists());
    drop(store);
    assert!(Store::open(dir.path().to_owned())
        .unwrap()
        .agents()
        .unwrap()
        .is_empty());
}
#[test]
fn environment_patch_preserves_deletes_and_rejects_host_overrides_without_writing() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = Store::open(dir.path().to_owned()).unwrap();
    let a = fixture();
    store.insert(vec![a.clone()]).unwrap();
    let mut update = edit();
    update.environment.insert("TEST_TOKEN".into(), None);
    update
        .environment
        .insert("PROVIDER_TOKEN".into(), Some("new-secret".into()));
    store.save(&a.id, 1, update).unwrap();
    assert_eq!(
        store.agents().unwrap()[0].environment,
        BTreeMap::from([("PROVIDER_TOKEN".into(), "new-secret".into())])
    );
    let before = fs::read(store.path()).unwrap();
    for key in [
        "BUZZ_PRIVATE_KEY",
        "buzz_auth_tag",
        "BUZZ_ACP_LAZY_POOL",
        "BUZZ_MANAGED_AGENT",
        "GIT_CONFIG_COUNT",
        "NOSTR_PRIVATE_KEY",
        "bad=key",
    ] {
        let mut update = edit();
        update
            .environment
            .insert(key.into(), Some("do-not-echo".into()));
        let error = store.save(&a.id, 2, update).unwrap_err();
        assert!(!error.contains("do-not-echo"));
        assert_eq!(fs::read(store.path()).unwrap(), before);
    }
}
#[test]
fn malformed_store_never_becomes_empty_or_overwritten() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = Store::open(dir.path().to_owned()).unwrap();
    let a = fixture();
    store.insert(vec![a.clone()]).unwrap();
    fs::write(store.path(), b"{broken-secret").unwrap();
    assert!(store.save(&a.id, 1, edit()).is_err());
    assert!(store.snapshot().is_err());
    assert_eq!(fs::read(store.path()).unwrap(), b"{broken-secret");
    drop(store);
    assert!(Store::open(dir.path().to_owned()).is_err());
}
#[test]
fn durable_enablement_is_not_a_config_revision() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = Store::open(dir.path().to_owned()).unwrap();
    let a = fixture();
    store.insert(vec![a.clone()]).unwrap();
    store.enabled(&a.id, true).unwrap();
    store.enabled(&a.id, false).unwrap();
    drop(store);
    let store = Store::open(dir.path().to_owned()).unwrap();
    assert!(!store.agents().unwrap()[0].enabled);
    assert_eq!(store.agents().unwrap()[0].revision, 1);
}
#[test]
fn launch_preference_persists_without_a_config_revision_and_overrides_enablement() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = Store::open(dir.path().to_owned()).unwrap();
    let a = fixture();
    store.insert(vec![a.clone()]).unwrap();
    assert!(!store.agents().unwrap()[0].starts_on_launch());
    store.enabled(&a.id, true).unwrap();
    assert!(store.agents().unwrap()[0].starts_on_launch());
    store.start_on_app_launch(&a.id, false).unwrap();
    assert!(store.start_on_app_launch("missing", true).is_err());
    drop(store);
    let store = Store::open(dir.path().to_owned()).unwrap();
    let saved = &store.agents().unwrap()[0];
    assert_eq!(saved.start_on_app_launch, Some(false));
    assert!(saved.enabled && !saved.starts_on_launch());
    assert_eq!(saved.revision, 1);
}
#[test]
fn identity_and_transport_validation_rejects_duplicates_and_argument_loss() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = Store::open(dir.path().to_owned()).unwrap();
    let a = fixture();
    assert!(store.insert(vec![a.clone(), a.clone()]).is_err());
    store.insert(vec![a.clone()]).unwrap();
    for argument in ["one,two", "", "a\0b"] {
        let mut update = edit();
        update.harness.args = vec![argument.into()];
        assert!(store.save(&a.id, 1, update).is_err());
    }
    assert_eq!(store.agents().unwrap()[0].revision, 1);
}
#[cfg(unix)]
#[test]
fn symlink_store_and_lock_are_refused() {
    use std::os::unix::fs::symlink;
    let dir = tempfile::tempdir().unwrap();
    let target = dir.path().join("target");
    fs::write(&target, "untouched").unwrap();
    symlink(&target, dir.path().join("controller.lock")).unwrap();
    assert!(Store::open(dir.path().to_owned()).is_err());
    fs::remove_file(dir.path().join("controller.lock")).unwrap();
    symlink(&target, dir.path().join("agents.json")).unwrap();
    assert!(Store::open(dir.path().to_owned()).is_err());
    assert_eq!(fs::read(target).unwrap(), b"untouched");
}

#[test]
fn closing_store_releases_lock_even_with_inherited_file_description() {
    let dir = tempfile::tempdir().unwrap();
    let store = Store::open(dir.path().to_owned()).unwrap();
    // dup/fork share the flock's open-file description. A concurrently spawning
    // child can retain it until exec despite the parent's close-on-exec flag.
    let inherited = store._lock.try_clone().unwrap();
    assert!(Store::open(dir.path().to_owned()).is_err());
    drop(store);
    let reopened = Store::open(dir.path().to_owned()).unwrap();
    drop(inherited);
    assert!(Store::open(dir.path().to_owned()).is_err());
    drop(reopened);
    Store::open(dir.path().to_owned()).unwrap();
}

#[test]
fn avatar_save_preserve_clear_pending_cas_and_reopen() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = Store::open(dir.path().to_owned()).unwrap();
    let a = fixture();
    store.insert(vec![a.clone()]).unwrap();
    let mut update = edit();
    update.picture = Some("https://images.example/brain.png".into());
    store.save(&a.id, 1, update).unwrap();
    assert_eq!(
        store.snapshot().unwrap().agents[0].picture.as_deref(),
        Some("https://images.example/brain.png")
    );
    assert!(store.snapshot().unwrap().agents[0].profile_pending);
    drop(store);
    let mut store = Store::open(dir.path().to_owned()).unwrap();
    assert!(store.snapshot().unwrap().agents[0].profile_pending);
    store.save(&a.id, 2, edit()).unwrap(); // Omitted picture preserves the managed override.
    assert_eq!(
        store.agents().unwrap()[0].picture.as_deref(),
        Some("https://images.example/brain.png")
    );
    assert!(store.profile_published(&a.id, 2).is_err());
    assert!(store.snapshot().unwrap().agents[0].profile_pending);
    store.profile_published(&a.id, 3).unwrap();
    assert!(!store.snapshot().unwrap().agents[0].profile_pending);
    let mut update = edit();
    update.picture = Some("https://images.example/brain.png".into());
    store.save(&a.id, 3, update).unwrap();
    assert!(!store.snapshot().unwrap().agents[0].profile_pending); // Unchanged does not republish.
    let mut update = edit();
    update.picture = Some(String::new());
    store.save(&a.id, 4, update).unwrap();
    assert!(store.snapshot().unwrap().agents[0].profile_pending);
    drop(store);
    let store = Store::open(dir.path().to_owned()).unwrap();
    assert_eq!(store.agents().unwrap()[0].picture.as_deref(), Some(""));
    assert_eq!(store.agents().unwrap()[0].imported, a.imported);
}

#[test]
fn invalid_avatar_and_stale_save_leave_persistent_bytes_unchanged() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = Store::open(dir.path().to_owned()).unwrap();
    let a = fixture();
    store.insert(vec![a.clone()]).unwrap();
    let before = fs::read(store.path()).unwrap();
    for value in [
        "http://images.example/a.png",
        "data:image/png;base64,AA==",
        "https://user:secret@images.example/a.png",
        "not a URL",
    ] {
        let mut update = edit();
        update.picture = Some(value.into());
        assert!(store.save(&a.id, 1, update).is_err());
        assert_eq!(fs::read(store.path()).unwrap(), before);
    }
    let mut update = edit();
    update.picture = Some("https://images.example/new.png".into());
    assert!(store.save(&a.id, 0, update).is_err());
    assert_eq!(fs::read(store.path()).unwrap(), before);
}

#[test]
fn instruction_adoption_is_cas_pinned_and_failure_preserves_previous_bytes() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = Store::open(dir.path().to_owned()).unwrap();
    let baseline = store.instructions().unwrap();
    assert!(baseline
        .composition
        .text()
        .starts_with("## Core\n\n### Buzz identity\n\nYou are an agent operating inside Buzz"));
    let mut selection = baseline.draft();
    selection
        .composition
        .modules
        .retain(|m| m.plugin_id != "buzz.projects");
    selection
        .composition
        .plugins
        .iter_mut()
        .find(|p| p.id == "buzz.projects")
        .unwrap()
        .enabled = false;
    store.adopt_instructions(1, selection.clone()).unwrap();
    let saved = store.instructions().unwrap();
    assert_eq!(saved.revision, 2);
    assert_eq!(saved.draft(), selection);
    let before = fs::read(store.path()).unwrap();
    assert!(store.adopt_instructions(1, baseline.draft()).is_err());
    assert_eq!(fs::read(store.path()).unwrap(), before);
    // Fail before replacing settings, without relying on chmod under privileged tests.
    fs::remove_file(dir.path().join("agents.previous.json")).unwrap();
    fs::create_dir(dir.path().join("agents.previous.json")).unwrap();
    assert!(store.adopt_instructions(2, baseline.draft()).is_err());
    assert_eq!(fs::read(store.path()).unwrap(), before);
    drop(store);
    let reopened = Store::open(dir.path().to_owned()).unwrap();
    assert_eq!(reopened.instructions().unwrap().draft(), selection);
    assert_eq!(fs::read(reopened.path()).unwrap(), before);
}

#[test]
fn migrated_store_pins_once_and_missing_instructions_never_become_defaults() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("agents.json");
    fs::write(&path, r#"{"version":1,"agents":[],"future":"preserve"}"#).unwrap();
    let store = Store::open(dir.path().to_owned()).unwrap();
    assert_eq!(store.instructions().unwrap().revision, 1);
    let mut data: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    assert_eq!(data["version"], 3);
    assert_eq!(data["future"], "preserve");
    data.as_object_mut().unwrap().remove("instructions");
    fs::write(&path, serde_json::to_vec(&data).unwrap()).unwrap();
    assert!(store.snapshot().is_err());
    drop(store);
    assert!(Store::open(dir.path().to_owned()).is_err());
    let after: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    assert_eq!(after, data);
}

#[test]
fn version_two_baseline_splits_metadata_without_changing_launch_identity() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("agents.json");
    let current = include_str!("../../instructions/base.md");
    let incoming = current.find("## Incoming Turn Contract").unwrap();
    let cli = current.find("## Buzz CLI").unwrap();
    let legacy = format!("{}{}", &current[..incoming], &current[cli..]);
    let projects = legacy.find("## Projects").unwrap();
    let behavior = legacy.find("## Conversational Agent Creation").unwrap();
    let plugins = ["buzz.agent-instructions", "buzz.projects"]
        .into_iter()
        .map(|id| crate::InstructionPlugin {
            id: id.into(),
            revision: "bundled".into(),
            enabled: true,
        })
        .collect::<Vec<_>>();
    let module =
        |plugin: &str, id: &str, title: &str, order, text: &str| crate::InstructionModule {
            key: format!("{plugin}/{id}"),
            title: title.into(),
            plugin_id: plugin.into(),
            revision: "bundled".into(),
            order,
            category: None,
            text: text.into(),
        };
    let saved = crate::SavedInstructions {
        revision: 7,
        composition: crate::InstructionComposition {
            categories: Vec::new(),
            modules: vec![
                module(
                    "buzz.agent-instructions",
                    "before-projects",
                    "Buzz and CLI",
                    0,
                    &legacy[..projects],
                ),
                module(
                    "buzz.projects",
                    "projects",
                    "Projects",
                    10,
                    &legacy[projects..behavior],
                ),
                module(
                    "buzz.agent-instructions",
                    "after-projects",
                    "Agent behavior",
                    20,
                    &legacy[behavior..],
                ),
            ],
            plugins,
        },
        inactive_modules: Vec::new(),
    };
    let identity = saved.identity();
    let mut instructions = serde_json::to_value(saved).unwrap();
    instructions
        .as_object_mut()
        .unwrap()
        .remove("inactiveModules");
    fs::write(
        &path,
        serde_json::to_vec(&json!({
            "version": 2,
            "agents": [],
            "instructions": instructions
        }))
        .unwrap(),
    )
    .unwrap();

    let store = Store::open(dir.path().to_owned()).unwrap();
    let migrated = store.instructions().unwrap();
    assert_eq!(migrated.revision, 7);
    assert_eq!(migrated.identity(), identity);
    assert_eq!(migrated.composition.text(), legacy);
    assert_eq!(migrated.composition.modules.len(), 13);
    assert!(migrated
        .composition
        .modules
        .iter()
        .all(|module| module.key != "buzz.agent-instructions/incoming-turn"));
    let document: Value = serde_json::from_slice(&fs::read(path).unwrap()).unwrap();
    assert_eq!(document["version"], 3);
}

#[test]
fn invalid_composition_is_rejected_without_persistence() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = Store::open(dir.path().to_owned()).unwrap();
    let baseline = store.instructions().unwrap().draft();
    let before = fs::read(store.path()).unwrap();
    for failure in 0..8 {
        let mut bad = baseline.clone();
        match failure {
            0 => bad
                .composition
                .modules
                .push(bad.composition.modules[0].clone()),
            1 => bad.composition.modules[0].revision = "unmatched".into(),
            2 => bad.composition.modules[0].text = "x".repeat(1_048_577),
            3 => bad.composition.modules[0].text = "invalid\0text".into(),
            4 => bad.composition.modules.reverse(),
            5 => bad.composition.modules.clear(),
            6 => bad
                .inactive_modules
                .push(bad.composition.modules[0].clone()),
            _ => {
                let mut inactive = bad.composition.modules[0].clone();
                inactive.key = format!("{}/inactive", inactive.plugin_id);
                inactive.text = "invalid\0text".into();
                bad.inactive_modules.push(inactive);
            }
        }
        assert!(store.adopt_instructions(1, bad).is_err());
        assert_eq!(fs::read(store.path()).unwrap(), before);
    }
}
