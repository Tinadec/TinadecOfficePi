using System.Diagnostics;

namespace TinadecTools.Tests;

public sealed class PackagingPrerequisiteTests
{
    private static readonly string ProjectPath = Path.GetFullPath(Path.Combine(
        AppContext.BaseDirectory,
        "..", "..", "..", "..", "..",
        "TinadecTools", "TinadecTools.csproj"));

    [Theory]
    [InlineData("ValidateBundledRipgrepForReleaseBuild", "Release")]
    [InlineData("ValidateBundledRipgrepForPublish", "Debug")]
    public async Task PackagingValidation_FailsWhenBundledRipgrepIsMissing(string target, string configuration)
    {
        var missingPath = Path.Combine(Path.GetTempPath(), $"missing-rg-{Guid.NewGuid():N}");
        var result = await RunMsbuildAsync(target, configuration, missingPath);

        Assert.NotEqual(0, result.ExitCode);
        Assert.Contains("Required bundled ripgrep binary is missing", result.Output, StringComparison.Ordinal);
        Assert.Contains(missingPath, result.Output, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task DebugBuildValidation_DoesNotRequireBundledRipgrep()
    {
        var missingPath = Path.Combine(Path.GetTempPath(), $"missing-rg-{Guid.NewGuid():N}");
        var result = await RunMsbuildAsync("ValidateBundledRipgrepForReleaseBuild", "Debug", missingPath);

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
            "-nologo"
        })
        {
            startInfo.ArgumentList.Add(argument);
        }

        using var process = Process.Start(startInfo)!;
        var stdout = process.StandardOutput.ReadToEndAsync();
        var stderr = process.StandardError.ReadToEndAsync();
        await process.WaitForExitAsync();
        return (process.ExitCode, await stdout + await stderr);
    }
}
