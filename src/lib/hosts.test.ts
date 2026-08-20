import { describe, expect, test } from "bun:test";
import { authedCloneUrl, fileUrl, parseRefKey, parseRepoInput, refKey, refLabel, cloneUrl } from "./hosts";

describe("parseRepoInput", () => {
  test("owner/name defaults to github", () => {
    expect(parseRepoInput("BinaryBourbon/fountain")).toEqual({ host: "github.com", owner: "BinaryBourbon", name: "fountain" });
  });

  test("full URLs, .git suffixes, trailing paths, scp form", () => {
    for (const input of [
      "https://github.com/owner/repo",
      "http://www.github.com/owner/repo.git",
      "github.com/owner/repo/tree/main/src",
      "git@github.com:owner/repo.git",
    ]) {
      expect(parseRepoInput(input)).toEqual({ host: "github.com", owner: "owner", name: "repo" });
    }
  });

  test("the other two hosts blacklight accepts", () => {
    expect(parseRepoInput("https://gitlab.com/group/project")).toEqual({ host: "gitlab.com", owner: "group", name: "project" });
    expect(parseRepoInput("codeberg.org/owner/repo")).toEqual({ host: "codeberg.org", owner: "owner", name: "repo" });
  });

  test("rejects other hosts and junk", () => {
    expect(parseRepoInput("https://bitbucket.org/owner/repo")).toBeNull();
    expect(parseRepoInput("https://git.example.com/owner/repo")).toBeNull();
    expect(parseRepoInput("just-a-word")).toBeNull();
    expect(parseRepoInput("")).toBeNull();
    expect(parseRepoInput("owner/../etc")).toBeNull();
  });
});

describe("keys and labels", () => {
  test("round-trips through the agent-name key", () => {
    const ref = parseRepoInput("gitlab.com/group/project")!;
    expect(refKey(ref)).toBe("gitlab.com/group/project");
    expect(parseRefKey(refKey(ref))).toEqual(ref);
    expect(parseRefKey("nope/two")).toBeNull();
    expect(parseRefKey("evil.com/a/b")).toBeNull();
  });

  test("github reads as owner/name, other hosts carry the host", () => {
    expect(refLabel({ host: "github.com", owner: "o", name: "r" })).toBe("o/r");
    expect(refLabel({ host: "codeberg.org", owner: "o", name: "r" })).toBe("codeberg.org/o/r");
  });

  test("clone URL", () => {
    expect(cloneUrl({ host: "github.com", owner: "o", name: "r" })).toBe("https://github.com/o/r.git");
  });

  test("authenticated clone URL uses each host's expected username, never the token itself", () => {
    expect(authedCloneUrl({ host: "github.com", owner: "o", name: "r" })).toBe("https://x-access-token:$GITHUB_TOKEN@github.com/o/r.git");
    expect(authedCloneUrl({ host: "gitlab.com", owner: "g", name: "p" })).toBe("https://oauth2:$GITHUB_TOKEN@gitlab.com/g/p.git");
    expect(authedCloneUrl({ host: "codeberg.org", owner: "g", name: "p" })).toBe("https://token:$GITHUB_TOKEN@codeberg.org/g/p.git");
  });
});

describe("fileUrl", () => {
  const gh = { host: "github.com", owner: "o", name: "r" } as const;

  test("github ranges, single lines, whole files", () => {
    expect(fileUrl(gh, "main", ".github/workflows/ci.yml", 14, 29)).toBe("https://github.com/o/r/blob/main/.github/workflows/ci.yml#L14-L29");
    expect(fileUrl(gh, "main", "a.yml", 14)).toBe("https://github.com/o/r/blob/main/a.yml#L14");
    expect(fileUrl(gh, "main", "/a.yml")).toBe("https://github.com/o/r/blob/main/a.yml");
  });

  test("each host spells its own path and range", () => {
    expect(fileUrl({ host: "gitlab.com", owner: "g", name: "p" }, "main", "a.yml", 3, 9)).toBe("https://gitlab.com/g/p/-/blob/main/a.yml#L3-9");
    expect(fileUrl({ host: "codeberg.org", owner: "g", name: "p" }, "main", "a.yml", 3, 9)).toBe("https://codeberg.org/g/p/src/branch/main/a.yml#L3-L9");
  });

  test("encodes path segments, leaves a slashed branch readable", () => {
    expect(fileUrl(gh, "release/v1", "k8s/some file.yaml")).toBe("https://github.com/o/r/blob/release/v1/k8s/some%20file.yaml");
    expect(fileUrl(gh, "main", "k8s/a#b.yaml")).toBe("https://github.com/o/r/blob/main/k8s/a%23b.yaml");
  });
});
