using System.Text.Json;
using TinadecTools.Abstractions;
using TinadecTools.Tools.Command;

namespace TinadecTools.Tests;

public sealed class RuntimeReadinessTests
{
    [Fact]
    public async Task HandleAsync_ReportsRequiredRuntimeDependenciesAndBlockers()
    {
        var result = await RuntimeReadinessTool.HandleAsync(
            new RuntimeReadinessParams(),
            CancellationToken.None);

        Assert.Equal(["ripgrep", "git", "bash"], result.Dependencies.Select(item => item.Id));
        Assert.Equal(result.Dependencies.All(item => item.Available), result.Ready);
        Assert.Equal(result.Dependencies.Count(item => !item.Available), result.Blockers.Count);
        Assert.All(result.Dependencies.Where(item => !item.Available), item => Assert.False(string.IsNullOrWhiteSpace(item.Error)));
    }

    [Fact]
    public async Task ProbeAsync_MissingExecutableReturnsActionableError()
    {
        var expectedError = "Stage the required test executable.";
        var result = await RuntimeReadinessTool.ProbeAsync(
            "missing",
            Path.Combine(Path.GetTempPath(), $"missing-{Guid.NewGuid():N}"),
            ["--version"],
            expectedError,
            CancellationToken.None);

        Assert.False(result.Available);
        Assert.Equal(expectedError, result.Error);
    }

    [Fact]
    public async Task GeneratedRegistry_AllowsUnapprovedRuntimeReadinessCall()
    {
        GeneratedToolRegistry.RegisterAll();
        using var parameters = JsonDocument.Parse("{}");

        var response = await ToolRegistry.DispatchAsync(new ToolCallRequest<JsonElement>
        {
            ToolId = "runtime_readiness",
            SessionId = "test",
            ToolCallId = 40,
            Approved = false,
            Params = parameters.RootElement.Clone()
        });

        Assert.True(response.IsSuccess);
        Assert.Equal(40, response.CallId);
        Assert.True(response.Response.TryGetProperty("dependencies", out var dependencies));
        Assert.Equal(3, dependencies.GetArrayLength());
    }
}
