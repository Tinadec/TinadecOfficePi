using System.Diagnostics;

namespace TinadecTools.Tests;

public sealed class PackagingPrerequisiteTests
{
    private static readonly string ProjectPath = Path.GetFullPath(Path.Combine(
        AppContext.BaseDirectory,
        "..", "..", "..", "..", "..",
        "TinadecTools", "TinadecTools.csproj"));

    [Theory]
    [InlineData("Build", "Release")]
    [InlineData("Publish", "Release")]
    [InlineData("Publish", "Debug")]
    public async Task PackagingTargets_FailClearlyWhenBundledRipgrepIsMissing(string target, string configuration)
    {
        var missingPath = Path.Combine(Path.GetTempPath(), $"missing-rg-{Guid.NewGuid():N}");
        var result = await RunMsbuildAsync(target, configuration, missingPath);

        Assert.NotEqual(0, result.ExitCode);
        Assert.Contains("Required bundled ripgrep binary is missing", result.Output, StringComparison.Ordinal);
        Assert.Contains(missingPath, result.Output, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("Stage the platform ripgrep payload", result.Output, StringComparison.Ordinal);
        Assert.Contains(OperatingSystem.IsWindows() ? "rg.exe" : "rg", result.Output, StringComparison.Ordinal);
    }

    [Fact]
    public async Task DebugBuildValidation_DoesNotRequireBundledRipgrep()
    {
        var missingPath = Path.Combine(Path.GetTempPath(), $"missing-rg-{Guid.NewGuid():N}");
        var result = await RunMsbuildAsync("Build", "Debug", missingPath);

        Assert.Equal(0, result.ExitCode);
    }

    private static async Task<(int ExitCode, string Output)> RunMsbuildAsync(
        string target,
        string configuration,
        string bundledRipgrepPath)
    {
        Assert.True(File.Exists(ProjectPath), $"TinadecTools project not found at {ProjectPath}");
        var startInfo = new ProcessStartInfo
        {
            FileName = "dotnet",
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true
        };
        foreach (var argument in new[]
        {
            "msbuild",
            ProjectPath,
            $"-target:{target}",
            $"-property:Configuration={configuration}",
            $"-property:BundledRipgrepPath={bundledRipgrepPath}",
            "-property:PublishAot=false",
            "-nologo"
        })
        {
            startInfo.ArgumentList.Add(argument);
        }
        if (target == "Publish")
            startInfo.ArgumentList.Add("-property:NoBuild=true");

        using var process = Process.Start(startInfo)!;
        var stdout = process.StandardOutput.ReadToEndAsync();
        var stderr = process.StandardError.ReadToEndAsync();
        await process.WaitForExitAsync();
        return (process.ExitCode, await stdout + await stderr);
    }
}
