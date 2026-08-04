# Desktop runtime payloads

The desktop does not download executable dependencies while it is running. `stage-runtime.mjs` downloads official payloads at build time, verifies their pinned SHA-256 hashes, and stages them before the installer is created.

## Node.js

The complete official Node.js 22.23.2 distribution is staged under `resources/runtime/node`, including `node.exe` and `npm.cmd` on Windows and `bin/node` and `bin/npm` on macOS/Linux. Hashes come from the official [Node.js release manifest](https://nodejs.org/dist/v22.23.2/SHASUMS256.txt).

## ripgrep and fd

Official ripgrep 15.2.0 and fd 10.3.0 release archives are staged as `rg[.exe]` and `fd[.exe]` under `resources/runtime/tools`. The staging script verifies every RID-specific archive before extraction. TinadecTools Release validation receives the verified ripgrep cache path through `BundledRipgrepPath`, and publish copies `rg` beside TinadecTools.

| RID | ripgrep archive SHA-256 | fd archive SHA-256 |
| --- | --- | --- |
| `win-x64` | `71b2fef860abe467217a538ff31de02f5258807c0129f771846f87bd029aafc5` | `318aa2a6fa664325933e81fda60d523fff29444129e91ebf0726b5b3bcd8b059` |
| `linux-x64` | `33e15bcf1624b25cdd2a55813a47a2f95dbe126268203e76aa6a585d1e7b149c` | `c3c2bc79f838e780173fc8f18b337ec273e7ba17c7ff8f551be29fc3c19b7916` |
| `linux-arm64` | `a740b91c82eaf9914cfedd353572f2791cbe0162c84101ee0951058f4dcbc90d` | `66f297e404400a3358e9a0c0b2f3f4725956e7e4435427a9ae56e22adbe73a68` |
| `osx-x64` | `af7825fcc69a2afc7a7aea55fc9af90e26421d8f20fe59df32e233c0b8a231c1` | `50d30f13fe3d5914b14c4fff5abcbd4d0cdab4b855970a6956f4f006c17117a3` |
| `osx-arm64` | `3750b2e93f37e0c692657da574d7019a101c0084da05a790c83fd335bad973e4` | `0570263812089120bc2a5d84f9e65cd0c25e4a4d724c80075c357239c74ae904` |

Sources: [ripgrep releases](https://github.com/BurntSushi/ripgrep/releases/tag/15.2.0) and [fd releases](https://github.com/sharkdp/fd/releases/tag/v10.3.0). The runtime override `TINADEC_TOOLS_RG_PATH` and `PATH` lookup remain available for Debug development, but they do not satisfy Release or Publish packaging validation.

## Git and Bash

Native Windows x64 builds download the official `PortableGit-2.55.0.3-64-bit.7z.exe` asset from [Git for Windows 2.55.0(3)](https://github.com/git-for-windows/git/releases/tag/v2.55.0.windows.3), verify SHA-256 `ab00566336b5472120f9a52d34f2e79c5406535792acb0548001ffd0bd090e5d`, and extract it under `resources/runtime/git`. Cross-building `win-x64` is intentionally rejected because the official self-extractor must run on Windows.

Preserve the PortableGit directory layout under the packaged runtime, for example:

```text
resources/runtime/git/cmd/git.exe
resources/runtime/git/bin/bash.exe
```

Packaged services prepend Node, tools, PortableGit `cmd`, and PortableGit `bin` to the inherited `PATH`:

```text
PATH=<resources>/runtime/node;<resources>/runtime/tools;<resources>/runtime/git/cmd;<resources>/runtime/git/bin;<existing PATH>
```

The sandboxed `command_run` process inherits this `PATH`. macOS and Linux packages retain system Git and Bash prerequisites; both commands must already be available on the target system `PATH`.

## Verification

Call the additive, read-only `runtime_readiness` tool through the existing TinadecTools JSON protocol:

```json
{"tool_id":"runtime_readiness","session_id":"doctor","toolcall_id":1,"approved":false,"params":{}}
```

The result reports paths and versions for `ripgrep`, `git`, and `bash`, plus actionable blockers. `fd` is staged for Pi and other packaged tooling even though TinadecTools does not call it directly.
