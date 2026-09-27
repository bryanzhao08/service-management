import { writeFile } from "node:fs/promises";

// Our foreground already fits the adaptive-icon safe zone. Keep the background
// full-bleed and avoid the generator's extra inset, which shrinks the lens.
const xml = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@mipmap/ic_launcher_background" />
    <foreground android:drawable="@mipmap/ic_launcher_foreground" />
</adaptive-icon>
`;
for (const name of ["ic_launcher", "ic_launcher_round"]) {
  await writeFile(`android/app/src/main/res/mipmap-anydpi-v26/${name}.xml`, xml);
}
await writeFile(
  "android/app/src/main/res/values/ic_launcher_background.xml",
  `<?xml version="1.0" encoding="utf-8"?>
<resources><color name="ic_launcher_background">#000000</color></resources>
`,
);
