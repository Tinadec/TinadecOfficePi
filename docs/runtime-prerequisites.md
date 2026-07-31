# TinadecTools runtime prerequisites

TinadecTools does not download executable dependencies while the application is running. Packaging must stage trusted, pinned binaries before creating an installer.

## ripgrep

`file_search` requires ripgrep. Release builds and every `dotnet publish` validate this prerequisite and fail when the platform binary is absent.

- Windows source: `native/rg/rg.exe`
- macOS/Linux source: `native/rg/rg`
- Published location: beside `TinadecTools` in the tools publish directory

The source path can be overridden at build time with `-p:BundledRipgrepPath=<absolute-path>`. The runtime override `TINADEC_TOOLS_RG_PATH` and `PATH` lookup remain available for Debug development, but they do not satisfy Release or Publish packaging validation.

## Git and Bash

The repository does not contain a PortableGit payload. Windows packaging must obtain a pinned, integrity-verified PortableGit archive during staging or provide it from an external build cache. It must not be downloaded when the desktop application starts.

Preserve the PortableGit directory layout under the packaged runtime, for example:

```text
resources/runtime/git/cmd/git.exe
resources/runtime/git/bin/bash.exe
```

When starting Gateway and TinadecTools, prepend both directories to the inherited `PATH`, with `cmd` before the existing path for Git and `bin` before any WindowsApps Bash shim:

```text
PATH=<resources>/runtime/git/cmd;<resources>/runtime/git/bin;<existing PATH>
```

The sandboxed `command_run` process inherits this `PATH`. macOS and Linux staging must likewise make runnable `git` and `bash` binaries available on the service `PATH`, whether supplied by the package or guaranteed by the target system.

## Verification

Call the additive, read-only `runtime_readiness` tool through the existing TinadecTools JSON protocol:

```json
{"tool_id":"runtime_readiness","session_id":"doctor","toolcall_id":1,"approved":false,"params":{}}
```

The result reports paths and versions for `ripgrep`, `git`, and `bash`, plus actionable blockers. `fd` is not a TinadecTools runtime dependency and must not be staged for this host.
