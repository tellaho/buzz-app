//! Saved launch inputs, independent of frontend/plugin activation and page lifetime.
use crate::Result;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeSet;

pub const LOCAL_INSTRUCTIONS_PLUGIN: &str = "buzz.local-instructions";
const LEGACY_BASE_SHA256: &str = "f17b163d32c9fd05f8d8e677fb7ccadafbe5f389422ef1c17ae01ad3e33873ae";
const BASE: &str = include_str!("../instructions/base.md");

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct InstructionModule {
    pub key: String,
    pub title: String,
    pub plugin_id: String,
    pub revision: String,
    pub order: i32,
    pub text: String,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct InstructionPlugin {
    pub id: String,
    pub revision: String,
    pub enabled: bool,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct InstructionComposition {
    pub modules: Vec<InstructionModule>,
    pub plugins: Vec<InstructionPlugin>,
}
impl InstructionComposition {
    pub(crate) fn validate(&self) -> Result<()> {
        if self.modules.is_empty() || self.modules.len() > 128 || self.plugins.len() > 256 {
            return Err("Base instructions require 1–128 modules and at most 256 plugins".into());
        }
        let mut plugins = BTreeSet::new();
        for plugin in &self.plugins {
            identifier(&plugin.id)?;
            label(&plugin.revision, 256)?;
            if !plugins.insert(&plugin.id) {
                return Err("Duplicate instruction plugin".into());
            }
        }
        let mut keys = BTreeSet::new();
        let mut bytes = 0;
        let mut previous = None;
        for module in &self.modules {
            identifier(&module.plugin_id)?;
            label(&module.key, 256)?;
            label(&module.title, 256)?;
            label(&module.revision, 256)?;
            if !module.key.starts_with(&format!("{}/", module.plugin_id))
                || !keys.insert(&module.key)
                || module.text.contains('\0')
            {
                return Err("Invalid or duplicate instruction module".into());
            }
            let sort_key = (module.order, module.key.as_str());
            if previous.is_some_and(|prior| prior >= sort_key) {
                return Err("Instruction modules must be ordered by order and key".into());
            }
            previous = Some(sort_key);
            if !self.plugins.iter().any(|plugin| {
                plugin.enabled
                    && plugin.id == module.plugin_id
                    && plugin.revision == module.revision
            }) {
                return Err("Instruction module has no matching enabled plugin revision".into());
            }
            bytes += module.text.len();
            if bytes > 1_048_576 {
                return Err("Base instructions exceed the runtime size limit".into());
            }
        }
        if self.text().trim().is_empty() {
            return Err("Base instructions cannot be blank".into());
        }
        Ok(())
    }
    pub fn text(&self) -> String {
        self.modules.iter().map(|m| m.text.as_str()).collect()
    }
    pub(crate) fn hash(&self) -> String {
        format!("{:x}", Sha256::digest(self.text().as_bytes()))
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct InstructionDraft {
    pub composition: InstructionComposition,
    #[serde(default)]
    pub inactive_modules: Vec<InstructionModule>,
}
impl InstructionDraft {
    pub(crate) fn validate(&self) -> Result<()> {
        self.composition.validate()?;
        if self.composition.modules.len() + self.inactive_modules.len() > 128 {
            return Err("Base instructions require at most 128 active and available traits".into());
        }
        let mut keys = self
            .composition
            .modules
            .iter()
            .map(|module| module.key.as_str())
            .collect::<BTreeSet<_>>();
        let mut bytes = self
            .composition
            .modules
            .iter()
            .map(|m| m.text.len())
            .sum::<usize>();
        for module in &self.inactive_modules {
            validate_module(module)?;
            if !keys.insert(&module.key) {
                return Err("Instruction traits must have unique identities".into());
            }
            bytes += module.text.len();
            if bytes > 1_048_576 {
                return Err("Base instruction traits exceed the profile size limit".into());
            }
        }
        Ok(())
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SavedInstructions {
    pub revision: u64,
    pub composition: InstructionComposition,
    #[serde(default)]
    pub inactive_modules: Vec<InstructionModule>,
}
impl SavedInstructions {
    pub(crate) fn baseline() -> Self {
        let plugins = ["buzz.agent-instructions", "buzz.projects"]
            .into_iter()
            .map(|id| InstructionPlugin {
                id: id.into(),
                revision: "bundled".into(),
                enabled: true,
            })
            .collect::<Vec<_>>();
        let modules = split_source(BASE, &plugins).expect("embedded base prompt sections");
        Self {
            revision: 1,
            composition: InstructionComposition { modules, plugins },
            inactive_modules: Vec::new(),
        }
    }
    pub(crate) fn validate(&self) -> Result<()> {
        if self.revision == 0 || self.revision > 9_007_199_254_740_991 {
            return Err("Invalid saved instruction revision".into());
        }
        self.draft().validate()
    }
    pub(crate) fn identity(&self) -> InstructionIdentity {
        InstructionIdentity {
            revision: self.revision,
            sha256: self.composition.hash(),
        }
    }
    pub(crate) fn draft(&self) -> InstructionDraft {
        InstructionDraft {
            composition: self.composition.clone(),
            inactive_modules: self.inactive_modules.clone(),
        }
    }
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstructionIdentity {
    pub revision: u64,
    pub sha256: String,
}
fn identifier(value: &str) -> Result<()> {
    if value.is_empty()
        || value.len() > 80
        || !value
            .bytes()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, b'.' | b'-'))
    {
        return Err("Invalid instruction plugin identity".into());
    }
    Ok(())
}
fn label(value: &str, limit: usize) -> Result<()> {
    if value.trim().is_empty() || value.len() > limit || value.contains('\0') {
        return Err("Invalid instruction source metadata".into());
    }
    Ok(())
}

fn validate_module(module: &InstructionModule) -> Result<()> {
    identifier(&module.plugin_id)?;
    label(&module.key, 256)?;
    label(&module.title, 256)?;
    label(&module.revision, 256)?;
    if !module.key.starts_with(&format!("{}/", module.plugin_id)) || module.text.contains('\0') {
        return Err("Invalid instruction trait".into());
    }
    Ok(())
}

struct Section {
    plugin: &'static str,
    id: &'static str,
    title: &'static str,
    order: i32,
    marker: Option<&'static str>,
}

const SECTIONS: &[Section] = &[
    Section {
        plugin: "buzz.agent-instructions",
        id: "buzz-identity",
        title: "Buzz identity",
        order: 0,
        marker: None,
    },
    Section {
        plugin: "buzz.agent-instructions",
        id: "incoming-turn",
        title: "Incoming turn contract",
        order: 10,
        marker: Some("## Incoming Turn Contract"),
    },
    Section {
        plugin: "buzz.agent-instructions",
        id: "buzz-cli",
        title: "Buzz CLI",
        order: 20,
        marker: Some("## Buzz CLI"),
    },
    Section {
        plugin: "buzz.projects",
        id: "projects",
        title: "Projects",
        order: 30,
        marker: Some("## Projects"),
    },
    Section {
        plugin: "buzz.agent-instructions",
        id: "agent-creation",
        title: "Agent creation",
        order: 40,
        marker: Some("## Conversational Agent Creation"),
    },
    Section {
        plugin: "buzz.agent-instructions",
        id: "mentions",
        title: "Mentions",
        order: 50,
        marker: Some("## Communication Patterns\n\n### Mentions"),
    },
    Section {
        plugin: "buzz.agent-instructions",
        id: "callback-mentions",
        title: "Callback mentions",
        order: 60,
        marker: Some("### Callback Mentions"),
    },
    Section {
        plugin: "buzz.agent-instructions",
        id: "threading",
        title: "Threading",
        order: 70,
        marker: Some("### Threading"),
    },
    Section {
        plugin: "buzz.agent-instructions",
        id: "general-communication",
        title: "General communication",
        order: 80,
        marker: Some("### General"),
    },
    Section {
        plugin: "buzz.agent-instructions",
        id: "workspace",
        title: "Workspace",
        order: 90,
        marker: Some("## Workspace Layout"),
    },
    Section {
        plugin: "buzz.agent-instructions",
        id: "agent-memory",
        title: "Agent memory",
        order: 100,
        marker: Some("## Agent Memory"),
    },
    Section {
        plugin: "buzz.agent-instructions",
        id: "engineering-discipline",
        title: "Engineering discipline",
        order: 110,
        marker: Some("## Engineering Discipline"),
    },
    Section {
        plugin: "buzz.agent-instructions",
        id: "repository-workflow",
        title: "Repository workflow",
        order: 120,
        marker: Some("## Working in the Repo"),
    },
    Section {
        plugin: "buzz.agent-instructions",
        id: "autonomy",
        title: "Autonomy",
        order: 130,
        marker: Some("## Autonomy"),
    },
];

fn split_source(text: &str, plugins: &[InstructionPlugin]) -> Result<Vec<InstructionModule>> {
    let mut found = SECTIONS
        .iter()
        .filter_map(|section| {
            let start = section.marker.map_or(Some(0), |marker| text.find(marker))?;
            Some((start, section))
        })
        .collect::<Vec<_>>();
    found.sort_by_key(|(start, _)| *start);
    if found.first().map(|entry| entry.0) != Some(0) {
        return Err("Base prompt is missing its identity section".into());
    }
    let mut modules = Vec::with_capacity(found.len());
    for (index, (start, section)) in found.iter().enumerate() {
        let end = found.get(index + 1).map_or(text.len(), |entry| entry.0);
        let revision = plugins
            .iter()
            .find(|plugin| plugin.id == section.plugin && plugin.enabled)
            .ok_or("Base prompt section has no enabled source")?
            .revision
            .clone();
        modules.push(InstructionModule {
            key: format!("{}/{}", section.plugin, section.id),
            title: section.title.into(),
            plugin_id: section.plugin.into(),
            revision,
            order: section.order,
            text: text[*start..end].into(),
        });
    }
    if modules
        .iter()
        .map(|module| module.text.as_str())
        .collect::<String>()
        != text
    {
        return Err("Base prompt sections did not preserve the source bytes".into());
    }
    Ok(modules)
}

pub(crate) fn migrate_legacy_modules(saved: &mut SavedInstructions) -> Result<bool> {
    let keys = saved
        .composition
        .modules
        .iter()
        .map(|module| module.key.as_str())
        .collect::<Vec<_>>();
    if keys
        != [
            "buzz.agent-instructions/before-projects",
            "buzz.projects/projects",
            "buzz.agent-instructions/after-projects",
        ]
        || saved.composition.hash() != LEGACY_BASE_SHA256
    {
        return Ok(false);
    }
    let text = saved.composition.text();
    saved.composition.modules = split_source(&text, &saved.composition.plugins)?;
    Ok(true)
}
