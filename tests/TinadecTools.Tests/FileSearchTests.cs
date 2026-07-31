using TinadecTools.Tools.Search;
using TinadecTools.Tools.FileRW;

namespace TinadecTools.Tests;

public sealed class FileSearchTests : IDisposable
{
    private readonly string? _rgPath;
    private readonly string? _originalRgEnv;
    private readonly List<string> _temporaryDirectories = new();

    public FileSearchTests()
    {
        _originalRgEnv = Environment.GetEnvironmentVariable(RipgrepRunner.RgPathEnvVar);
        _rgPath = RipgrepTestPrerequisite.FindPath();
        if (_rgPath is not null)
            Environment.SetEnvironmentVariable(RipgrepRunner.RgPathEnvVar, _rgPath);
    }

    public void Dispose()
    {
        Environment.SetEnvironmentVariable(RipgrepRunner.RgPathEnvVar, _originalRgEnv);
        foreach (var directory in _temporaryDirectories)
        {
            if (Directory.Exists(directory))
                Directory.Delete(directory, recursive: true);
        }
    }

    // ── 基础搜索 ──────────────────────────────────────────────────────────────

    [RipgrepFact]
    public async Task BasicMatch_ReturnsMatchLineAndFileHash()
    {
        var dir = CreateTempDir();
        WriteFile(dir, "a.txt", "hello world\nsecond line\n");

        var resp = await FileSearch.HandleAsync(
            new FileSearchParams { Pattern = "hello", Path = dir },
            CancellationToken.None);

        Assert.True(resp.Success, resp.Error);
        var match = Assert.Single(resp.Lines);
        Assert.True(match.IsMatch);
        Assert.Equal(1, match.LineNumber);
        Assert.Contains("hello", match.Content);
        Assert.NotEmpty(resp.FileHashes);
    }

    [RipgrepFact]
    public async Task Submatches_ContainMatchedText()
    {
        var dir = CreateTempDir();
        WriteFile(dir, "b.txt", "foo bar baz\n");

        var resp = await FileSearch.HandleAsync(
            new FileSearchParams { Pattern = "bar", Path = dir },
            CancellationToken.None);

        Assert.True(resp.Success, resp.Error);
        var match = Assert.Single(resp.Lines);
        Assert.NotNull(match.Submatches);
        Assert.Contains(match.Submatches!, s => s.Text == "bar");
    }

    // ── Glob / Type 过滤 ──────────────────────────────────────────────────────

    [RipgrepFact]
    public async Task GlobFilter_OnlyMatchesSpecifiedExtension()
    {
        var dir = CreateTempDir();
        WriteFile(dir, "keep.cs",    "target content\n");
        WriteFile(dir, "ignore.txt", "target content\n");

        var resp = await FileSearch.HandleAsync(
            new FileSearchParams { Pattern = "target", Path = dir, Glob = "*.cs" },
            CancellationToken.None);

        Assert.True(resp.Success, resp.Error);
        Assert.All(resp.Lines, l => Assert.EndsWith(".cs", l.FilePath));
    }

    [RipgrepFact]
    public async Task TypeFilter_OnlyMatchesCsharpFiles()
    {
        var dir = CreateTempDir();
        WriteFile(dir, "code.cs",   "needle here\n");
        WriteFile(dir, "notes.txt", "needle here\n");

        var resp = await FileSearch.HandleAsync(
            new FileSearchParams { Pattern = "needle", Path = dir, Type = "cs" },
            CancellationToken.None);

        Assert.True(resp.Success, resp.Error);
        Assert.All(resp.Lines, l => Assert.EndsWith(".cs", l.FilePath));
    }

    // ── 大小写 ────────────────────────────────────────────────────────────────

    [RipgrepFact]
    public async Task CaseSensitiveFalse_MatchesUpperAndLower()
    {
        var dir = CreateTempDir();
        WriteFile(dir, "c.txt", "HELLO\nhello\nHeLLo\n");

        var resp = await FileSearch.HandleAsync(
            new FileSearchParams { Pattern = "hello", Path = dir, CaseSensitive = false },
            CancellationToken.None);

        Assert.True(resp.Success, resp.Error);
        Assert.Equal(3, resp.Lines.Count(l => l.IsMatch));
    }

    [RipgrepFact]
    public async Task CaseSensitiveTrue_RequiresExactCase()
    {
        var dir = CreateTempDir();
        WriteFile(dir, "d.txt", "HELLO\nhello\n");

        var resp = await FileSearch.HandleAsync(
            new FileSearchParams { Pattern = "hello", Path = dir, CaseSensitive = true },
            CancellationToken.None);

        Assert.True(resp.Success, resp.Error);
        Assert.Equal(1, resp.Lines.Count(l => l.IsMatch));
        Assert.Equal("hello", resp.Lines.First(l => l.IsMatch).Content);
    }

    // ── FixedStrings ──────────────────────────────────────────────────────────

    [RipgrepFact]
    public async Task FixedStrings_TreatsRegexCharsAsLiteral()
    {
        var dir = CreateTempDir();
        WriteFile(dir, "e.txt", "foo.bar\nfooXbar\n");

        // FixedStrings=true：'.' 是字面量，只应匹配 "foo.bar"
        var resp = await FileSearch.HandleAsync(
            new FileSearchParams { Pattern = "foo.bar", Path = dir, FixedStrings = true },
            CancellationToken.None);

        Assert.True(resp.Success, resp.Error);
        Assert.Equal(1, resp.Lines.Count(l => l.IsMatch));
        Assert.Contains("foo.bar", resp.Lines.First(l => l.IsMatch).Content);
    }

    // ── ContextLines ──────────────────────────────────────────────────────────

    [RipgrepFact]
    public async Task ContextLines_IncludesAdjacentLinesWithLineNumbers()
    {
        var dir = CreateTempDir();
        WriteFile(dir, "f.txt", "before\ntarget\nafter\n");

        var resp = await FileSearch.HandleAsync(
            new FileSearchParams { Pattern = "target", Path = dir, ContextLines = 1 },
            CancellationToken.None);

        Assert.True(resp.Success, resp.Error);
        var matchLine = Assert.Single(resp.Lines, l => l.IsMatch);
        Assert.Equal(2, matchLine.LineNumber);

        var ctxLines = resp.Lines.Where(l => !l.IsMatch).ToList();
        Assert.Contains(ctxLines, l => l.LineNumber == 1 && l.Content == "before");
        Assert.Contains(ctxLines, l => l.LineNumber == 3 && l.Content == "after");
    }

    // ── MaxResults 截断 ───────────────────────────────────────────────────────

    [RipgrepFact]
    public async Task MaxResults_TruncatesResultsAndSetsTruncatedFlag()
    {
        var dir = CreateTempDir();
        // 写10行都能命中
        WriteFile(dir, "g.txt", string.Join("\n", Enumerable.Range(1, 10).Select(i => $"match {i}")) + "\n");

        var resp = await FileSearch.HandleAsync(
            new FileSearchParams { Pattern = "match", Path = dir, MaxResults = 3 },
            CancellationToken.None);

        Assert.True(resp.Success, resp.Error);
        Assert.Equal(3, resp.Lines.Count(l => l.IsMatch));
        Assert.True(resp.Truncated);
    }

    // ── 无命中 ────────────────────────────────────────────────────────────────

    [RipgrepFact]
    public async Task NoMatch_ReturnsSuccessWithEmptyLines()
    {
        var dir = CreateTempDir();
        WriteFile(dir, "h.txt", "nothing relevant here\n");

        var resp = await FileSearch.HandleAsync(
            new FileSearchParams { Pattern = "zzznomatch", Path = dir },
            CancellationToken.None);

        Assert.True(resp.Success, resp.Error);
        Assert.Empty(resp.Lines);
        Assert.False(resp.Truncated);
    }

    // ── rg 找不到 ─────────────────────────────────────────────────────────────

    [Fact]
    public async Task RgNotFound_ReturnsFailureWithHelpfulError()
    {
        Environment.SetEnvironmentVariable(RipgrepRunner.RgPathEnvVar,
            Path.Combine(Path.GetTempPath(), $"rg-fake-{Guid.NewGuid():N}"));
        try
        {
            var resp = await FileSearch.HandleAsync(
                new FileSearchParams { Pattern = "x", Path = "." },
                CancellationToken.None);

            Assert.False(resp.Success);
            Assert.NotNull(resp.Error);
            Assert.Contains("ripgrep not found", resp.Error, StringComparison.OrdinalIgnoreCase);
        }
        finally
        {
            Environment.SetEnvironmentVariable(RipgrepRunner.RgPathEnvVar, _rgPath);
        }
    }

    // ── 空 pattern ────────────────────────────────────────────────────────────

    [Fact]
    public async Task EmptyPattern_ReturnsFailure()
    {
        var resp = await FileSearch.HandleAsync(
            new FileSearchParams { Pattern = "" },
            CancellationToken.None);

        Assert.False(resp.Success);
        Assert.NotNull(resp.Error);
    }

    // ── 辅助方法 ──────────────────────────────────────────────────────────────

    private string CreateTempDir()
    {
        var path = Path.Combine(FileToolRuntime.WorkspaceRoot, ".tinadec-tools-tests", $"search-{Guid.NewGuid():N}");
        Directory.CreateDirectory(path);
        _temporaryDirectories.Add(path);
        return path;
    }

    private static void WriteFile(string dir, string name, string content) =>
        File.WriteAllText(Path.Combine(dir, name), content);

}

internal sealed class RipgrepFactAttribute : FactAttribute
{
    public RipgrepFactAttribute()
    {
        if (RipgrepTestPrerequisite.FindPath() is null)
            Skip = $"ripgrep integration test requires rg on PATH or {RipgrepRunner.RgPathEnvVar}.";
    }
}

internal static class RipgrepTestPrerequisite
{
    public static string? FindPath()
    {
        var path = RipgrepRunner.ResolveRgPath();
        return File.Exists(path) ? Path.GetFullPath(path) : null;
    }
}
