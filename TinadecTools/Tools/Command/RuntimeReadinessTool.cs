using System.Text.Json.Serialization;
using TinadecTools.Abstractions;
using TinadecTools.Runtime;
using TinadecTools.Tools.Search;

namespace TinadecTools.Tools.Command;

public sealed class RuntimeReadinessParams { }

public sealed class RuntimeDependencyStatus
{
    [JsonPropertyName("id")]
    public string Id { get; set; } = string.Empty;

    [JsonPropertyName("available")]
    public bool Available { get; set; }

    [JsonPropertyName("path")]
    public string? Path { get; set; }

    [JsonPropertyName("version")]
    public string? Version { get; set; }

    [JsonPropertyName("error")]
    public string? Error { get; set; }
}

public sealed class RuntimeReadinessResponse
{
    [JsonPropertyName("ready")]
    public bool Ready { get; set; }

    [JsonPropertyName("dependencies")]
    public List<RuntimeDependencyStatus> Dependencies { get; set; } = new();

    [JsonPropertyName("blockers")]
    public List<string> Blockers { get; set; } = new();
}

[JsonSourceGenerationOptions(WriteIndented = false)]
[JsonSerializable(typeof(RuntimeReadinessParams))]
[JsonSerializable(typeof(RuntimeReadinessResponse))]
[JsonSerializable(typeof(RuntimeDependencyStatus))]
[JsonSerializable(typeof(List<RuntimeDependencyStatus>))]
[JsonSerializable(typeof(List<string>))]
internal partial class RuntimeReadinessToolJsonContext : JsonSerializerContext { }

public static class RuntimeReadinessTool
{
    [ToolFunction("runtime_readiness")]
    public static async ValueTask<RuntimeReadinessResponse> HandleAsync(
        RuntimeReadinessParams args,
        CancellationToken cancellationToken)
    {
        var rgPath = RipgrepRunner.ResolveRgPath();
        var dependencies = new List<RuntimeDependencyStatus>
        {
            await ProbeAsync(
                "ripgrep",
                File.Exists(rgPath) ? Path.GetFullPath(rgPath) : null,
                ["--version"],
                $"ripgrep is required for file_search. Stage {(OperatingSystem.IsWindows() ? "rg.exe" : "rg")} next to TinadecTools or set {RipgrepRunner.RgPathEnvVar}.",
                cancellationToken).ConfigureAwait(false),
            await ProbeAsync(
                "git",
                RuntimePrerequisites.FindExecutable("git"),
                ["--version"],
                RuntimePrerequisites.GitError,
                cancellationToken).ConfigureAwait(false),
            await ProbeAsync(
                "bash",
                RuntimePrerequisites.FindExecutable("bash"),
                ["--version"],
                RuntimePrerequisites.BashError,
                cancellationToken).ConfigureAwait(false)
        };

        var blockers = dependencies
            .Where(dependency => !dependency.Available)
            .Select(dependency => dependency.Error!)
            .ToList();

        return new RuntimeReadinessResponse
        {
            Ready = blockers.Count == 0,
            Dependencies = dependencies,
            Blockers = blockers
        };
    }

    internal static async Task<RuntimeDependencyStatus> ProbeAsync(
        string id,
        string? path,
        IReadOnlyList<string> versionArguments,
        string unavailableMessage,
        CancellationToken cancellationToken)
    {
        if (path is null || !File.Exists(path))
            return new RuntimeDependencyStatus { Id = id, Error = unavailableMessage };

        var result = await TerminalRunner.RunAsync(
            path,
            versionArguments,
            timeoutMs: 5_000,
            cancellationToken: cancellationToken,
            maxOutputChars: 4_096).ConfigureAwait(false);

        if (!result.Success)
        {
            var detail = result.TimedOut
                ? "version check timed out"
                : FirstLine(string.IsNullOrWhiteSpace(result.Stderr) ? result.Stdout : result.Stderr);
            return new RuntimeDependencyStatus
            {
                Id = id,
                Path = path,
                Error = $"{unavailableMessage} Probe failed: {detail}."
            };
        }

        return new RuntimeDependencyStatus
        {
            Id = id,
            Available = true,
            Path = path,
            Version = FirstLine(string.IsNullOrWhiteSpace(result.Stdout) ? result.Stderr : result.Stdout)
        };
    }

    private static string FirstLine(string value) =>
        value.Split(['\r', '\n'], StringSplitOptions.RemoveEmptyEntries).FirstOrDefault()?.Trim()
        ?? "no diagnostic output";
}
