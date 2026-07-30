import fs from 'node:fs/promises';
import path from 'node:path';
import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  HeadingLevel,
  ImageRun,
  PageNumber,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';

const markdownPath =
  process.argv[2] ??
  'D:\\Users\\lgq\\自动化\\am-config-inspector\\docs\\AM巡检自动化截图系统-自动化测试文档-v1.1.md';
const outputPath =
  process.argv[3] ??
  'D:\\Users\\lgq\\AM巡检自动化截图系统-自动化测试文档-v1.1.docx';
const imageDir =
  process.argv[4] ??
  'D:\\Users\\lgq\\自动化\\am-config-inspector\\docs\\assets\\am-screenshot-reference';

const markdown = await fs.readFile(markdownPath, 'utf8');

function cleanMarkdownText(value) {
  return value
    .replace(/\\([\\`*_[\]{}()#+\-.!|>])/g, '$1')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1');
}

function inlineRuns(value, options = {}) {
  const runs = [];
  const pattern = /(\*\*.*?\*\*|`[^`]+`)/g;
  let cursor = 0;

  for (const match of value.matchAll(pattern)) {
    if (match.index > cursor) {
      runs.push(
        new TextRun({
          text: cleanMarkdownText(value.slice(cursor, match.index)),
          ...options,
        }),
      );
    }

    const token = match[0];
    if (token.startsWith('**')) {
      runs.push(
        new TextRun({
          text: cleanMarkdownText(token.slice(2, -2)),
          bold: true,
          ...options,
        }),
      );
    } else {
      runs.push(
        new TextRun({
          text: token.slice(1, -1),
          font: 'Consolas',
          color: '8B2E2E',
          shading: {
            type: ShadingType.CLEAR,
            fill: 'F3F4F6',
          },
          ...options,
        }),
      );
    }
    cursor = match.index + token.length;
  }

  if (cursor < value.length) {
    runs.push(
      new TextRun({
        text: cleanMarkdownText(value.slice(cursor)),
        ...options,
      }),
    );
  }
  return runs.length > 0 ? runs : [new TextRun({ text: '', ...options })];
}

function paragraphFromText(value, options = {}) {
  return new Paragraph({
    children: inlineRuns(value),
    spacing: { after: 100, line: 320 },
    ...options,
  });
}

function parseTableRow(line) {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cleanMarkdownText(cell.trim()));
}

function isTableSeparator(line) {
  const cells = parseTableRow(line);
  return (
    cells.length > 0 &&
    cells.every((cell) => /^:?-{3,}:?$/.test(cell.replace(/\s/g, '')))
  );
}

function buildTable(rows) {
  const columnCount = Math.max(...rows.map((row) => row.length));
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: rows.map(
      (row, rowIndex) =>
        new TableRow({
          tableHeader: rowIndex === 0,
          children: Array.from({ length: columnCount }, (_, columnIndex) => {
            const value = row[columnIndex] ?? '';
            return new TableCell({
              shading:
                rowIndex === 0
                  ? {
                      type: ShadingType.CLEAR,
                      fill: 'DCE6F1',
                    }
                  : undefined,
              margins: {
                top: 80,
                bottom: 80,
                left: 100,
                right: 100,
              },
              borders: {
                top: {
                  style: BorderStyle.SINGLE,
                  size: 1,
                  color: 'B7C9DC',
                },
                bottom: {
                  style: BorderStyle.SINGLE,
                  size: 1,
                  color: 'B7C9DC',
                },
                left: {
                  style: BorderStyle.SINGLE,
                  size: 1,
                  color: 'B7C9DC',
                },
                right: {
                  style: BorderStyle.SINGLE,
                  size: 1,
                  color: 'B7C9DC',
                },
              },
              children: [
                new Paragraph({
                  children: [
                    new TextRun({
                      text: value,
                      bold: rowIndex === 0,
                      font: 'Microsoft YaHei',
                      size: 19,
                    }),
                  ],
                  spacing: { after: 0, line: 280 },
                }),
              ],
            });
          }),
        }),
    ),
  });
}

function parseMarkdown(value) {
  const lines = value.replace(/\r\n/g, '\n').split('\n');
  const children = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();

    if (!trimmed || /^---+$/.test(trimmed) || /^<!--.*-->$/.test(trimmed)) {
      index += 1;
      continue;
    }

    if (trimmed.startsWith('```')) {
      const codeLines = [];
      index += 1;
      while (index < lines.length && !lines[index].trim().startsWith('```')) {
        codeLines.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      children.push(
        new Paragraph({
          children: [
            new TextRun({
              text: codeLines.join('\n'),
              font: 'Consolas',
              size: 18,
              color: '1F2937',
            }),
          ],
          shading: {
            type: ShadingType.CLEAR,
            fill: 'F3F4F6',
          },
          indent: { left: 240, right: 240 },
          spacing: { before: 80, after: 160, line: 280 },
        }),
      );
      continue;
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const headingMap = {
        1: HeadingLevel.TITLE,
        2: HeadingLevel.HEADING_1,
        3: HeadingLevel.HEADING_2,
        4: HeadingLevel.HEADING_3,
        5: HeadingLevel.HEADING_4,
        6: HeadingLevel.HEADING_5,
      };
      children.push(
        new Paragraph({
          text: cleanMarkdownText(headingMatch[2]),
          heading: headingMap[level],
          pageBreakBefore: level === 2 && children.length > 0,
          spacing: { before: level === 1 ? 0 : 180, after: 120 },
        }),
      );
      index += 1;
      continue;
    }

    if (
      trimmed.startsWith('|') &&
      index + 1 < lines.length &&
      isTableSeparator(lines[index + 1])
    ) {
      const rows = [parseTableRow(line)];
      index += 2;
      while (index < lines.length && lines[index].trim().startsWith('|')) {
        rows.push(parseTableRow(lines[index]));
        index += 1;
      }
      children.push(buildTable(rows));
      children.push(new Paragraph({ text: '', spacing: { after: 100 } }));
      continue;
    }

    const bulletMatch = line.match(/^\s*-\s+(.+)$/);
    if (bulletMatch) {
      children.push(
        paragraphFromText(bulletMatch[1], {
          bullet: { level: 0 },
          indent: { left: 420, hanging: 180 },
        }),
      );
      index += 1;
      continue;
    }

    const numberedMatch = line.match(/^\s*(\d+)\.\s+(.+)$/);
    if (numberedMatch) {
      children.push(
        new Paragraph({
          children: [
            new TextRun({
              text: `${numberedMatch[1]}. `,
              bold: true,
              color: '284B63',
            }),
            ...inlineRuns(numberedMatch[2]),
          ],
          indent: { left: 360, hanging: 240 },
          spacing: { after: 80, line: 320 },
        }),
      );
      index += 1;
      continue;
    }

    children.push(paragraphFromText(line));
    index += 1;
  }

  return children;
}

function pngDimensions(buffer) {
  if (
    buffer.length >= 24 &&
    buffer[0] === 0x89 &&
    buffer.toString('ascii', 1, 4) === 'PNG'
  ) {
    return {
      width: buffer.readUInt32BE(16),
      height: buffer.readUInt32BE(20),
    };
  }
  return { width: 800, height: 450 };
}

function scaledDimensions(width, height) {
  const maxWidth = 560;
  const maxHeight = 620;
  const scale = Math.min(maxWidth / width, maxHeight / height, 1);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

async function buildReferenceAppendix() {
  const children = [
    new Paragraph({
      text: '附录A：原始文档界面参考图',
      heading: HeadingLevel.HEADING_1,
      pageBreakBefore: true,
    }),
    paragraphFromText(
      '以下图片来自原始文档，仅用于帮助开发者和其他AI理解页面入口与操作路径；正式运行时必须使用本次发布消息中的动态模型名和标签名。',
    ),
  ];

  const groups = [
    {
      title: 'A.1 模版修改——首页搜索、输入和搜索结果',
      files: ['source-01.png', 'source-02.png', 'source-03.png'],
    },
    {
      title: 'A.2 新首页普通标签——首页标签和标签内容页',
      files: ['source-04.png', 'source-05.png'],
    },
    {
      title: 'A.3 新首页New——入口和内容页',
      files: ['source-06.png', 'source-07.png'],
    },
    {
      title: 'A.4 More Style Video——Effects与Video页面',
      files: ['source-08.png', 'source-09.png'],
    },
    {
      title: 'A.5 More Style AI Filter——Effects、Filter与标签页面',
      files: ['source-10.png', 'source-11.png', 'source-12.png'],
    },
  ];

  let imageSequence = 0;
  for (const group of groups) {
    children.push(
      new Paragraph({
        text: group.title,
        heading: HeadingLevel.HEADING_2,
        pageBreakBefore: true,
      }),
    );

    for (const fileName of group.files) {
      imageSequence += 1;
      const filePath = path.join(imageDir, fileName);
      const data = await fs.readFile(filePath);
      const original = pngDimensions(data);
      const transformation = scaledDimensions(original.width, original.height);
      children.push(
        new Paragraph({
          children: [
            new ImageRun({
              data,
              transformation,
              type: 'png',
            }),
          ],
          alignment: AlignmentType.CENTER,
          spacing: { before: 100, after: 80 },
        }),
      );
      children.push(
        new Paragraph({
          children: [
            new TextRun({
              text: `原始界面参考图 ${imageSequence}`,
              italics: true,
              color: '5B6573',
              size: 18,
            }),
          ],
          alignment: AlignmentType.CENTER,
          spacing: { after: 140 },
        }),
      );
    }
  }
  return children;
}

const content = parseMarkdown(markdown);
content.push(...(await buildReferenceAppendix()));

const document = new Document({
  creator: 'AM巡检自动化截图系统',
  title: 'AM巡检自动化截图系统——自动化测试文档',
  description:
    '根据正式发布消息动态生成AIMirror实体Android手机截图任务的规则、流程和验收依据。',
  styles: {
    default: {
      document: {
        run: {
          font: 'Microsoft YaHei',
          size: 21,
          color: '1F2937',
        },
        paragraph: {
          spacing: { line: 320, after: 100 },
        },
      },
      title: {
        run: {
          font: 'Microsoft YaHei',
          size: 36,
          bold: true,
          color: '183B56',
        },
        paragraph: {
          alignment: AlignmentType.CENTER,
          spacing: { after: 300 },
        },
      },
      heading1: {
        run: {
          font: 'Microsoft YaHei',
          size: 28,
          bold: true,
          color: '183B56',
        },
        paragraph: {
          spacing: { before: 240, after: 140 },
        },
      },
      heading2: {
        run: {
          font: 'Microsoft YaHei',
          size: 24,
          bold: true,
          color: '284B63',
        },
        paragraph: {
          spacing: { before: 180, after: 100 },
        },
      },
      heading3: {
        run: {
          font: 'Microsoft YaHei',
          size: 22,
          bold: true,
          color: '3C5F78',
        },
        paragraph: {
          spacing: { before: 140, after: 80 },
        },
      },
    },
  },
  sections: [
    {
      properties: {
        page: {
          size: {
            width: 11906,
            height: 16838,
          },
          margin: {
            top: 1080,
            right: 1080,
            bottom: 1080,
            left: 1080,
          },
        },
      },
      footers: {
        default: new Footer({
          children: [
            new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [
                new TextRun({
                  text: 'AM巡检自动化截图系统 v1.0  ·  第 ',
                  size: 17,
                  color: '6B7280',
                }),
                new TextRun({
                  children: [PageNumber.CURRENT],
                  size: 17,
                  color: '6B7280',
                }),
                new TextRun({
                  text: ' 页',
                  size: 17,
                  color: '6B7280',
                }),
              ],
            }),
          ],
        }),
      },
      children: content,
    },
  ],
});

await fs.writeFile(outputPath, await Packer.toBuffer(document));

const stat = await fs.stat(outputPath);
console.log(
  JSON.stringify(
    {
      markdownPath,
      outputPath,
      imageDir,
      outputBytes: stat.size,
    },
    null,
    2,
  ),
);
