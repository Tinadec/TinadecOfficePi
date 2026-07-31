namespace TinadecTools.Runtime;

internal static class RuntimePrerequisites
{
    public const string GitError =
        "Git could not be started. Git tools require git on PATH; Windows packages must stage PortableGit and prepend its cmd directory to PATH.";

    public const string BashError =
        "Bash could not be started. Bash commands require bash on PATH; Windows packages must stage PortableGit and prepend its bin directory to PATH.";

    public static string? FindExecutable(string executable)
    {
        if (string.IsNullOrWhiteSpace(executable))
            return null;

        if (Path.IsPathFullyQualified(executable)
            || executable.Contains(Path.DirectorySeparatorChar)
            || executable.Contains(Path.AltDirectorySeparatorChar))
        {
            var fullPath = Path.GetFullPath(executable);
            return File.Exists(fullPath) ? fullPath : null;
        }

        var names = CandidateNames(executable);
        var pathEntries = Environment.GetEnvironmentVariable("PATH")?.Split(Path.PathSeparator)
            ?? [];

        foreach (var entry in pathEntries)
        {
            var directory = entry.Trim().Trim('"');
            if (directory.Length == 0)
                continue;

            foreach (var name in names)
            {
                var candidate = Path.Combine(directory, name);
                if (File.Exists(candidate))
                    return Path.GetFullPath(candidate);
            }
        }

        return null;
    }

    public static bool IsBashExecutable(string executable)
    {
        var name = Path.GetFileNameWithoutExtension(executable);
        return name.Equals("bash", StringComparison.OrdinalIgnoreCase);
    }

    private static IReadOnlyList<string> CandidateNames(string executable)
    {
        if (!OperatingSystem.IsWindows() || Path.HasExtension(executable))
            return [executable];

        var extensions = Environment.GetEnvironmentVariable("PATHEXT")?.Split(';')
            ?? [".COM", ".EXE", ".BAT", ".CMD"];
        return extensions.Select(extension => executable + extension.ToLowerInvariant()).Prepend(executable).ToArray();
    }
}
