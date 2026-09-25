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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub category: Option<String>,
    pub text: String,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct InstructionCategory {
    pub id: String,
    pub title: String,
    pub tone: String,
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
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub categories: Vec<InstructionCategory>,
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
        let mut categories = BTreeSet::new();
        for category in &self.categories {
            identifier(&category.id)?;
            heading(&category.title)?;
            if !valid_tone(&category.tone) || !categories.insert(category.id.as_str()) {
                return Err("Invalid or duplicate instruction category".into());
            }
        }
        let mut bytes = 0;
        let mut previous = None;
        for module in &self.modules {
            identifier(&module.plugin_id)?;
            label(&module.key, 256)?;
            heading(&module.title)?;
            label(&module.revision, 256)?;
            if !module.key.starts_with(&format!("{}/", module.plugin_id))
                || !keys.insert(&module.key)
                || module.text.contains('\0')
            {
                return Err("Invalid or duplicate instruction module".into());
            }
            if !self.categories.is_empty()
                && (!module
                    .category
                    .as_deref()
                    .is_some_and(|category| categories.contains(category))
                    || !valid_instruction_body(&module.text))
            {
                return Err("Invalid categorized instruction entry".into());
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
        if self.categories.is_empty() {
            return self.modules.iter().map(|m| m.text.as_str()).collect();
        }
        let mut sections = Vec::new();
        for category in &self.categories {
            let modules = self
                .modules
                .iter()
                .filter(|module| module.category.as_deref() == Some(category.id.as_str()))
                .collect::<Vec<_>>();
            if modules.is_empty() {
                continue;
            }
            let mut entries = vec![format!("## {}", category.title.trim())];
            entries.extend(modules.into_iter().map(|module| {
                let body = module.text.trim();
                if body.is_empty() {
                    format!("### {}", module.title.trim())
                } else {
                    format!("### {}\n\n{body}", module.title.trim())
                }
            }));
            sections.push(entries.join("\n\n"));
        }
        if sections.is_empty() {
            String::new()
        } else {
            format!("{}\n", sections.join("\n\n"))
        }
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
            if !self.composition.categories.is_empty()
                && !module.category.as_deref().is_some_and(|category| {
                    self.composition
                        .categories
                        .iter()
                        .any(|candidate| candidate.id == category)
                })
            {
                return Err("Inactive instruction entry has no category".into());
            }
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
            composition: InstructionComposition {
                categories: default_categories(),
                modules,
                plugins,
            },
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

fn heading(value: &str) -> Result<()> {
    label(value, 256)?;
    if value.contains(['\r', '\n']) {
        return Err("Instruction headings must be single lines".into());
    }
    Ok(())
}

fn validate_module(module: &InstructionModule) -> Result<()> {
    identifier(&module.plugin_id)?;
    label(&module.key, 256)?;
    heading(&module.title)?;
    label(&module.revision, 256)?;
    if !module.key.starts_with(&format!("{}/", module.plugin_id)) || module.text.contains('\0') {
        return Err("Invalid instruction trait".into());
    }
    Ok(())
}

fn valid_tone(value: &str) -> bool {
    matches!(
        value,
        "slate"
            | "red"
            | "orange"
            | "amber"
            | "lime"
            | "green"
            | "teal"
            | "cyan"
            | "blue"
            | "indigo"
            | "purple"
            | "pink"
    )
}

fn valid_instruction_body(text: &str) -> bool {
    let mut fence = None;
    let mut previous_text = false;
    for line in text.lines() {
        let content = line.trim_start_matches(' ');
        if line.len() - content.len() > 3 {
            continue;
        }
        let marker = if content.starts_with("```") {
            Some('`')
        } else if content.starts_with("~~~") {
            Some('~')
        } else {
            None
        };
        if let Some(marker) = marker {
            if fence == Some(marker) {
                fence = None;
            } else if fence.is_none() {
                fence = Some(marker);
            }
            previous_text = false;
            continue;
        }
        if fence.is_none() {
            let hashes = content.bytes().take_while(|byte| *byte == b'#').count();
            if (1..=3).contains(&hashes)
                && content
                    .as_bytes()
                    .get(hashes)
                    .is_none_or(|byte| byte.is_ascii_whitespace())
            {
                return false;
            }
            let underline = content.trim_end();
            if previous_text
                && !underline.is_empty()
                && (underline.bytes().all(|byte| byte == b'=')
                    || underline.bytes().all(|byte| byte == b'-'))
            {
                return false;
            }
            previous_text = !content.trim().is_empty();
        }
    }
    true
}

fn default_categories() -> Vec<InstructionCategory> {
    [
        ("core", "Core", "purple"),
        ("capabilities", "Capabilities", "blue"),
        ("communication", "Communication Patterns", "green"),
        ("practice", "Practice", "orange"),
        ("custom", "Custom", "amber"),
        ("plugins", "Plugins", "cyan"),
        ("uncategorized", "Uncategorized", "slate"),
    ]
    .into_iter()
    .map(|(id, title, tone)| InstructionCategory {
        id: id.into(),
        title: title.into(),
        tone: tone.into(),
    })
    .collect()
}

struct Section {
    plugin: &'static str,
    id: &'static str,
    title: &'static str,
    order: i32,
    category: &'static str,
    marker: Option<&'static str>,
}

const SECTIONS: &[Section] = &[
    Section {
        plugin: "buzz.agent-instructions",
        id: "buzz-identity",
        title: "Buzz identity",
        order: 0,
        category: "core",
        marker: None,
    },
    Section {
        plugin: "buzz.agent-instructions",
        id: "incoming-turn",
        title: "Incoming turn contract",
        order: 10,
        category: "core",
        marker: Some("## Incoming Turn Contract"),
    },
    Section {
        plugin: "buzz.agent-instructions",
        id: "buzz-cli",
        title: "Buzz CLI",
        order: 20,
        category: "core",
        marker: Some("## Buzz CLI"),
    },
    Section {
        plugin: "buzz.projects",
        id: "projects",
        title: "Projects",
        order: 30,
        category: "plugins",
        marker: Some("## Projects"),
    },
    Section {
        plugin: "buzz.agent-instructions",
        id: "agent-creation",
        title: "Agent creation",
        order: 40,
        category: "capabilities",
        marker: Some("## Conversational Agent Creation"),
    },
    Section {
        plugin: "buzz.agent-instructions",
        id: "mentions",
        title: "Mentions",
        order: 50,
        category: "communication",
        marker: Some("## Communication Patterns\n\n### Mentions"),
    },
    Section {
        plugin: "buzz.agent-instructions",
        id: "callback-mentions",
        title: "Callback mentions",
        order: 60,
        category: "communication",
        marker: Some("### Callback Mentions"),
    },
    Section {
        plugin: "buzz.agent-instructions",
        id: "threading",
        title: "Threading",
        order: 70,
        category: "communication",
        marker: Some("### Threading"),
    },
    Section {
        plugin: "buzz.agent-instructions",
        id: "general-communication",
        title: "General communication",
        order: 80,
        category: "communication",
        marker: Some("### General"),
    },
    Section {
        plugin: "buzz.agent-instructions",
        id: "workspace",
        title: "Workspace",
        order: 90,
        category: "capabilities",
        marker: Some("## Workspace Layout"),
    },
    Section {
        plugin: "buzz.agent-instructions",
        id: "agent-memory",
        title: "Agent memory",
        order: 100,
        category: "capabilities",
        marker: Some("## Agent Memory"),
    },
    Section {
        plugin: "buzz.agent-instructions",
        id: "engineering-discipline",
        title: "Engineering discipline",
        order: 110,
        category: "practice",
        marker: Some("## Engineering Discipline"),
    },
    Section {
        plugin: "buzz.agent-instructions",
        id: "repository-workflow",
        title: "Repository workflow",
        order: 120,
        category: "practice",
        marker: Some("## Working in the Repo"),
    },
    Section {
        plugin: "buzz.agent-instructions",
        id: "autonomy",
        title: "Autonomy",
        order: 130,
        category: "practice",
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
            category: Some(section.category.into()),
            text: instruction_body(&text[*start..end]),
        });
    }
    Ok(modules)
}

fn instruction_body(text: &str) -> String {
    let lines = text.lines().collect::<Vec<_>>();
    let mut index = 0;
    while lines.get(index).is_some_and(|line| line.trim().is_empty()) {
        index += 1;
    }
    while lines.get(index).is_some_and(|line| {
        let line = line.trim();
        let hashes = line.bytes().take_while(|byte| *byte == b'#').count();
        (1..=3).contains(&hashes)
            && line
                .as_bytes()
                .get(hashes)
                .is_some_and(|byte| byte.is_ascii_whitespace())
    }) {
        index += 1;
        while lines.get(index).is_some_and(|line| line.trim().is_empty()) {
            index += 1;
        }
    }
    lines[index..].join("\n").trim_end().into()
}

fn split_legacy_source(
    text: &str,
    plugins: &[InstructionPlugin],
) -> Result<Vec<InstructionModule>> {
    let mut modules = split_source(text, plugins)?;
    let mut found = SECTIONS
        .iter()
        .filter_map(|section| {
            let start = section.marker.map_or(Some(0), |marker| text.find(marker))?;
            Some(start)
        })
        .collect::<Vec<_>>();
    found.sort_unstable();
    for (index, module) in modules.iter_mut().enumerate() {
        let start = found[index];
        let end = found.get(index + 1).copied().unwrap_or(text.len());
        module.category = None;
        module.text = text[start..end].into();
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
    saved.composition.modules = split_legacy_source(&text, &saved.composition.plugins)?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn structured(body: &str) -> InstructionComposition {
        InstructionComposition {
            categories: vec![
                InstructionCategory {
                    id: "first".into(),
                    title: "First category".into(),
                    tone: "purple".into(),
                },
                InstructionCategory {
                    id: "empty".into(),
                    title: "Empty category".into(),
                    tone: "slate".into(),
                },
            ],
            modules: vec![InstructionModule {
                key: "fixture/entry".into(),
                title: "An entry".into(),
                plugin_id: "fixture".into(),
                revision: "v1".into(),
                order: 0,
                category: Some("first".into()),
                text: body.into(),
            }],
            plugins: vec![InstructionPlugin {
                id: "fixture".into(),
                revision: "v1".into(),
                enabled: true,
            }],
        }
    }

    #[test]
    fn categorized_text_generates_headings_and_omits_empty_categories() {
        let composition = structured("Body Markdown.\n");
        assert_eq!(
            composition.text(),
            "## First category\n\n### An entry\n\nBody Markdown.\n"
        );
        composition.validate().unwrap();
    }

    #[test]
    fn baseline_places_projects_with_plugin_instructions() {
        let saved = SavedInstructions::baseline();
        let projects = saved
            .composition
            .modules
            .iter()
            .find(|module| module.key == "buzz.projects/projects")
            .expect("Projects instructions");
        assert_eq!(projects.category.as_deref(), Some("plugins"));
    }

    #[test]
    fn categorized_entries_reject_h1_through_h3_outside_fences() {
        for heading in ["# One", "## Two", "### Three"] {
            assert!(structured(heading).validate().is_err());
        }
        assert!(structured("Setext heading\n---").validate().is_err());
        structured("```md\n## Example\n```").validate().unwrap();
        structured("#### Body subheading").validate().unwrap();
    }
}
