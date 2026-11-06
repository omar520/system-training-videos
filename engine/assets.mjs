// Fictional files for uploads on screen: a plain silhouette "photo" and sample PDFs.
// Made here, so no real person's photo or document ever appears.
//   const { photo, pdf } = await assets();
//   await d.upload(button, photo);
//   await d.upload(button, pdf("Delivery plan (sample)", ["A fictional file. No real data."]));
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { loadConfig, paths } from "./project.mjs";

function makePhoto(file) {
  // A head-and-shoulders silhouette on a grey background, 600 x 600
  const inside = "lt(hypot(X-300,Y-235),112)+lt(pow((X-300)/235,2)+pow((Y-610)/215,2),1)";
  execFileSync("ffmpeg", [
    "-v",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    "color=c=black:s=600x600",
    "-vf",
    `geq=r='if(${inside},90,215)':g='if(${inside},100,219)':b='if(${inside},112,224)'`,
    "-frames:v",
    "1",
    file,
  ]);
}

function makePdf(file, title, lines) {
  const esc = (s) => s.replace(/[\\()]/g, (c) => `\\${c}`);
  const text = [
    "BT /F1 22 Tf 72 740 Td",
    `(${esc(title)}) Tj`,
    "/F1 12 Tf",
    ...lines.map((l, i) => `0 ${i === 0 ? -36 : -18} Td (${esc(l)}) Tj`),
    "ET",
  ].join("\n");
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets = [];
  objs.forEach((o, i) => {
    offsets.push(Buffer.byteLength(out));
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  fs.writeFileSync(file, out);
}

/** Make the files once and return their paths. */
export async function assets() {
  const dir = path.join(paths(await loadConfig()).work, "assets");
  fs.mkdirSync(dir, { recursive: true });
  const photo = path.join(dir, "profile-photo.png");
  if (!fs.existsSync(photo)) makePhoto(photo);
  return {
    photo,
    pdf(title, lines = ["A fictional file made for a training video.", "No real data."]) {
      const file = path.join(dir, `${title.replace(/[<>:"/\\|?*]/g, "-")}.pdf`);
      if (!fs.existsSync(file)) makePdf(file, title, lines);
      return file;
    },
  };
}
