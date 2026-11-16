const fs = require("fs");
function walk(dir) {
  let r = [];
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = dir + "/" + f.name;
    if (f.isDirectory()) r = r.concat(walk(p));
    else if (/Client\.tsx$/.test(f.name)) r.push(p);
  }
  return r;
}
const files = walk("src/app/admin").concat(walk("src/app/staff"));
for (const f of files) {
  let s = fs.readFileSync(f, "utf8");
  const before = s;
  s = s.replace(/import \{ PortalShell \} from "@\/components\/PortalShell";\r?\n?/g, "");
  s = s.replace(/<PortalShell[\s\S]*?>/g, "<>");
  s = s.replace(/<\/PortalShell>/g, "</>");
  if (s !== before) fs.writeFileSync(f, s);
  console.log(f, s !== before);
}
