import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const manifestPath = join(
  process.cwd(),
  "src-tauri",
  "gen",
  "android",
  "app",
  "src",
  "main",
  "AndroidManifest.xml"
);

let manifest;
try {
  manifest = await readFile(manifestPath, "utf8");
} catch {
  throw new Error(
    "AndroidManifest.xml was not found. Run npm run android:init before npm run android:prepare."
  );
}

const applicationTag = manifest.indexOf("<application");
if (applicationTag < 0) {
  throw new Error("Could not find the <application> element in AndroidManifest.xml.");
}

const additions = [
  '<uses-permission android:name="android.permission.RECORD_AUDIO" />',
  '<uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS" />',
  '<uses-feature android:name="android.hardware.microphone" android:required="false" />'
];

const missing = additions.filter((entry) => {
  const name = entry.match(/android:name="([^"]+)"/)?.[1];
  return name && !manifest.includes(name);
});

if (missing.length > 0) {
  manifest =
    manifest.slice(0, applicationTag) +
    "    " + missing.join("\n    ") + "\n" +
    manifest.slice(applicationTag);
  await writeFile(manifestPath, manifest, "utf8");
}

console.log(
  missing.length === 0
    ? "Android microphone permissions already configured."
    : "Added Android microphone recording permissions."
);
