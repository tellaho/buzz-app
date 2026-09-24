//! Saved launch inputs, independent of frontend/plugin activation and page lifetime.
use crate::Result;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeSet;

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
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SavedInstructions {
    pub revision: u64,
    pub composition: InstructionComposition,
}
impl SavedInstructions {
    pub(crate) fn baseline() -> Self {
        let modules = [
            (
                "buzz.agent-instructions",
                "before-projects",
                "Buzz and CLI",
                0,
                include_str!("../../../src/bundled/agent-instructions/before-projects.md"),
            ),
            (
                "buzz.projects",
                "projects",
                "Projects",
                10,
                include_str!("../../../src/bundled/projects/instructions.md"),
            ),
            (
                "buzz.agent-instructions",
                "after-projects",
                "Agent behavior",
                20,
                include_str!("../../../src/bundled/agent-instructions/after-projects.md"),
            ),
        ]
        .into_iter()
        .map(|(plugin, id, title, order, text)| InstructionModule {
            key: format!("{plugin}/{id}"),
            title: title.into(),
            plugin_id: plugin.into(),
            revision: "bundled".into(),
            order,
            text: text.into(),
        })
        .collect();
        Self {
            revision: 1,
            composition: InstructionComposition {
                modules,
                plugins: ["buzz.agent-instructions", "buzz.projects"]
                    .into_iter()
                    .map(|id| InstructionPlugin {
                        id: id.into(),
                        revision: "bundled".into(),
                        enabled: true,
                    })
                    .collect(),
            },
        }
    }
    pub(crate) fn validate(&self) -> Result<()> {
        if self.revision == 0 || self.revision > 9_007_199_254_740_991 {
            return Err("Invalid saved instruction revision".into());
        }
        self.composition.validate()
    }
    pub(crate) fn identity(&self) -> InstructionIdentity {
        InstructionIdentity {
            revision: self.revision,
            sha256: self.composition.hash(),
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
