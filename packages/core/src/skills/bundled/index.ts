import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  BUNDLED_SKILL_NAMES,
  type BundledSkillName,
  DEFAULT_BUNDLED_SKILL_NAMES,
  OPT_IN_BUNDLED_SKILL_NAMES,
  RUNTIME_ONLY_BUNDLED_SKILL_NAMES,
  SUPER_BOT_BUNDLED_SKILL_NAMES,
} from "../bundled-names";
import { parseSkillMarkdown } from "../parse";

export {
  BUNDLED_SKILL_NAMES,
  type BundledSkillName,
  DEFAULT_BUNDLED_SKILL_NAMES,
  OPT_IN_BUNDLED_SKILL_NAMES,
  RUNTIME_ONLY_BUNDLED_SKILL_NAMES,
  SUPER_BOT_BUNDLED_SKILL_NAMES,
};

// Compiled single-file builds (bun build --compile, desktop bundles) cannot
// read skills from the virtual filesystem — the host ships them as files and
// points us at the directory via NAKAMA_BUNDLED_SKILLS_DIR.
const bundledDir =
  process.env.NAKAMA_BUNDLED_SKILLS_DIR ??
  path.join(path.dirname(fileURLToPath(import.meta.url)));

export async function readBundledSkillMarkdown(
  name: BundledSkillName
): Promise<string> {
  return readFile(path.join(bundledDir, name, "SKILL.md"), "utf8");
}

export async function readBundledSkillBody(
  name: BundledSkillName
): Promise<string> {
  const sourcePath = path.join(bundledDir, name, "SKILL.md");
  return parseSkillMarkdown(await readBundledSkillMarkdown(name), sourcePath)
    .body;
}
