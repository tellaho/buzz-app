# App-owned base instructions

`base.md` is a byte-for-byte import of the Buzz ACP base identified in
`source.json`. It is the frozen parity fixture, not fetched at runtime.
The source revision matches the runtime pin at the time of import. This is a
one-time ownership transfer, **not** automatic inheritance on runtime upgrades.
Do not append the runtime-owned session model or per-turn routing context here.

The initial carryover test pins both the bytes and SHA-256. Future intentional
instruction changes must explicitly update that contract; preserve the original
source provenance. The native initial composition splits the source into fourteen traits
under `src/bundled/agent-instructions` and `src/bundled/projects`; regression tests
require their concatenation to equal this file. The native store pins those bytes
once, then only explicit revision-checked adoption replaces them.

Each launch writes the saved composition into its existing private `runs/agent-*` directory
before spawning ACP. The file is never rewritten by Save, is passed through
`BUZZ_ACP_BASE_PROMPT_FILE`, and lives until confirmed process teardown. Failure
to materialize it prevents spawn; it never falls back silently to the engine base.
This launch artifact is not a retained per-session instruction receipt.

To independently verify the initial import from a trusted Buzz checkout:

```sh
git -C /path/to/buzz show \
  deda09c18c78d48847b032557c331f28faf64ee8:crates/buzz-acp/src/base_prompt.md \
  | cmp - crates/agent-controller/instructions/base.md
```
