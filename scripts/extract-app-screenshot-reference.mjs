import fs from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';

const sourcePath =
  process.argv[2] ?? 'D:\\Users\\lgq\\AM巡检功能自动化系统。.docx';
const outputDir =
  process.argv[3] ??
  'D:\\Users\\lgq\\自动化\\am-config-inspector\\docs\\assets\\am-screenshot-reference';

function decodeXml(value) {
  return value
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&');
}

function naturalCompare(left, right) {
  return left.localeCompare(right, undefined, {
    numeric: true,
    sensitivity: 'base',
  });
}

const sourceBuffer = await fs.readFile(sourcePath);
const zip = await JSZip.loadAsync(sourceBuffer);
const documentXml = await zip.file('word/document.xml').async('string');
const relationshipsXml = await zip
  .file('word/_rels/document.xml.rels')
  .async('string');

const relationshipTargets = new Map();
for (const match of relationshipsXml.matchAll(
  /<Relationship\b[^>]*\bId="([^"]+)"[^>]*\bTarget="([^"]+)"[^>]*\/?>/g,
)) {
  relationshipTargets.set(match[1], match[2]);
}

await fs.mkdir(outputDir, { recursive: true });

const mediaEntries = Object.values(zip.files)
  .filter((entry) => !entry.dir && entry.name.startsWith('word/media/'))
  .sort((left, right) => naturalCompare(left.name, right.name));

const extractedNames = new Map();
for (const [index, entry] of mediaEntries.entries()) {
  const extension = path.extname(entry.name).toLowerCase() || '.bin';
  const outputName = `source-${String(index + 1).padStart(2, '0')}${extension}`;
  await fs.writeFile(
    path.join(outputDir, outputName),
    await entry.async('nodebuffer'),
  );
  extractedNames.set(entry.name.replace(/^word\//, ''), outputName);
}

const orderedLines = [];
let paragraphNumber = 0;
for (const paragraphMatch of documentXml.matchAll(/<w:p\b[\s\S]*?<\/w:p>/g)) {
  paragraphNumber += 1;
  const paragraphXml = paragraphMatch[0];
  const text = [...paragraphXml.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)]
    .map((match) => decodeXml(match[1]))
    .join('')
    .replace(/\s+/g, ' ')
    .trim();

  const imageNames = [];
  for (const imageMatch of paragraphXml.matchAll(
    /<a:blip\b[^>]*\br:embed="([^"]+)"/g,
  )) {
    const target = relationshipTargets.get(imageMatch[1]);
    if (!target) continue;
    const normalizedTarget = target.replace(/\\/g, '/').replace(/^\.\//, '');
    imageNames.push(extractedNames.get(normalizedTarget) ?? normalizedTarget);
  }

  if (text || imageNames.length > 0) {
    orderedLines.push(
      `P${String(paragraphNumber).padStart(3, '0')}: ${text}${
        imageNames.length > 0 ? ` [图片: ${imageNames.join(', ')}]` : ''
      }`,
    );
  }
}

await fs.writeFile(
  path.join(outputDir, 'source-document-order.txt'),
  orderedLines.join('\n'),
  'utf8',
);

console.log(
  JSON.stringify(
    {
      sourcePath,
      outputDir,
      paragraphCount: paragraphNumber,
      imageCount: mediaEntries.length,
      indexFile: path.join(outputDir, 'source-document-order.txt'),
    },
    null,
    2,
  ),
);
