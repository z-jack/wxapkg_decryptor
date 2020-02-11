const fs = require("fs");
const path = require("path");

const formatHex = (n, d = 8) => "0x" + n.toString(16).padStart(d, "0");

const fileBuffer = fs.readFileSync("__APP__.wxapkg");
const baseOffset = 0x400;
const detectIndexed = true;
const useReference = true;

// Mini-app meta data
let xorNumber = 0x66;
let headerOffset = 1;
let indexOffset = 19;
let dataOffset = 0;

// Decode file
const xorBuffer = Buffer.allocUnsafe(fileBuffer.length - 6);
for (let i = 0; i < fileBuffer.length - 6; i++) {
  if (i < baseOffset) {
    xorBuffer[i] = fileBuffer[i + 6];
  } else {
    xorBuffer[i] = fileBuffer[i + 6] ^ xorNumber;
  }
}

// Find start block
const fileList = [];
let startOffset = 0;
for (let i = baseOffset; i < xorBuffer.length; i++) {
  // All file name starts with "/"
  if (xorBuffer.readUInt8(i) === 0x2f) {
    for (; i < xorBuffer.length; i++) {
      // Due to WeChat mini-app file size is always less than 16M, therefore the highest digit is always 0x00
      if (xorBuffer.readUInt8(i) === 0) {
        startOffset = i + 8;
        break;
      }
    }
    break;
  }
}

// Do the loop until file list end
for (let i = startOffset; i < xorBuffer.length; ) {
  // Assume the first file content is not started with 0x00
  if (xorBuffer.readUInt8(i) !== 0x00) {
    dataOffset = i;
    break;
  }
  let length = xorBuffer.readUInt32BE(i);
  let name = new TextDecoder("utf-8").decode(
    xorBuffer.slice(i + 4, i + 4 + length)
  );
  let offset = xorBuffer.readUInt32BE(i + length + 4);
  let size = xorBuffer.readUInt32BE(i + length + 8);
  fileList.push({
    name,
    offset,
    size
  });
  i += length + 12;
}

// Print meta data
console.log(
  `XOR key: ${formatHex(xorNumber, 2)}
- wxapkg meta data:
  * header\t${formatHex(headerOffset)}
  * index\t${formatHex(indexOffset)}
  * data\t${formatHex(dataOffset)}`
);

// Try parse un-indexed html file scopes
for (let i = fileList[0].offset; i > dataOffset; ) {
  // Packed html files always start with "\t<style>" and end with "</script>"
  const tailString = new TextDecoder("ascii").decode(
    xorBuffer.slice(i - 20, i)
  );
  if (!tailString.includes("</script>")) {
    break;
  }
  // Almost all packed html files are less than 1k
  const kbString = new TextDecoder("ascii").decode(
    xorBuffer.slice(i - 1024, i)
  );
  const startIndex = kbString.lastIndexOf("\t<style>");
  if (startIndex < 0) {
    break;
  }
  const fileString = kbString.slice(startIndex);
  const nameMatch = /\$gwx\(\s*['"]\.([^'"]+)\.[^.\s]+['"]\s*\)/gi.exec(
    fileString
  );
  if (!nameMatch || nameMatch.length < 2) {
    break;
  }
  const name = nameMatch[1] + ".html";
  const size = kbString.length - startIndex + 1;
  const offset = i - size;
  fileList.unshift({
    name,
    offset,
    size
  });
  i = offset;
}

// Try parse /app-service.js
for (let i = fileList[0].offset; i > dataOffset; ) {
  // Packed app-service.js file always starts with "\tvar __wxAppData"
  // Assume app-service.js file is less than 4M
  const mbBuffer = xorBuffer.slice(
    Math.max(i - 4 * 1024 * 1024, dataOffset),
    i
  );
  const mbString = new TextDecoder("ascii").decode(mbBuffer);
  let startIndex = mbString.lastIndexOf("\tvar __wxAppData");
  if (startIndex < 0) {
    break;
  }
  const name = "/app-service.js";
  const size = mbBuffer.length - startIndex + 1;
  const offset = i - size;
  fileList.unshift({
    name,
    offset,
    size
  });
  break;
}

// Try parse /app-config.json
for (let i = fileList[0].offset; i > dataOffset; ) {
  // Packed app-config.json file always starts with '{"' and ends with "}"
  const tailString = new TextDecoder("ascii").decode(
    xorBuffer.slice(i - 20, i)
  );
  if (!tailString.includes("}")) {
    break;
  }
  // Assume app-config.json file is less than 1M
  const mbBuffer = xorBuffer.slice(Math.max(i - 1024 * 1024, dataOffset), i);
  const mbString = new TextDecoder("ascii").decode(mbBuffer);
  const startIndex = mbString.indexOf('{"');
  if (startIndex < 0) {
    break;
  }
  const name = "/app-config.json";
  const size = mbString.length - startIndex + 1;
  const offset = i - size;
  fileList.unshift({
    name,
    offset,
    size
  });
  i = offset;
  break;
}

// Try parse un-indexed assets based on given references
if (useReference) {
  // Recursively get file list, thanks to https://stackoverflow.com/a/47492545
  const isDirectory = path => fs.statSync(path).isDirectory();
  const getDirectories = p =>
    fs
      .readdirSync(p)
      .map(name => path.posix.join(p, name))
      .filter(isDirectory);

  const isFile = path =>
    fs.statSync(path).isFile() && !path.endsWith(".gitkeep");
  const getFiles = p =>
    fs
      .readdirSync(p)
      .map(name => path.posix.join(p, name))
      .filter(isFile);

  const getFilesRecursively = path => {
    let dirs = getDirectories(path);
    let files = dirs
      .map(dir => getFilesRecursively(dir))
      .reduce((a, b) => a.concat(b), []);
    return files.concat(getFiles(path));
  };

  const residualBuffer = xorBuffer.slice(dataOffset, fileList[0].offset + 1);
  const referencesList = getFilesRecursively("references")
    .map(
      p => p.slice(10) // ignore prefix
    )
    .map(p => {
      const referenceContent = fs.readFileSync("./references" + p);
      const referenceIndex = residualBuffer.indexOf(referenceContent);
      if (referenceIndex < 0) {
        return null;
      }
      return {
        name: p,
        offset: dataOffset + referenceIndex - 1,
        size: referenceContent.length
      };
    })
    .filter(x => x)
    .sort((a, b) => a.offset - b.offset);
  fileList.unshift(...referencesList);
}

// Try detect possible image assets
const unindexedList = [];
if (detectIndexed) {
  const residualBuffer = xorBuffer.slice(dataOffset, fileList[0].offset + 1);
  const isConflict = x =>
    unindexedList.find(
      o => o.offset - dataOffset < x && o.offset + o.size - dataOffset > x
    );
  const findFilesInBuffer = (headerMark, endMark, extension) => {
    if (
      !(headerMark instanceof Buffer) ||
      !(endMark instanceof Buffer) ||
      typeof extension !== "string"
    )
      return 0;
    let counter = 0;
    let pointer = residualBuffer.indexOf(headerMark);
    while (pointer >= 0) {
      if (isConflict(pointer)) {
        pointer = residualBuffer.indexOf(
          headerMark,
          pointer + headerMark.length
        );
      }
      let endIndex = residualBuffer.indexOf(endMark, pointer);
      if (endIndex < 0) break;
      unindexedList.push({
        name: `/${++counter}.${extension}`,
        offset: dataOffset + pointer - 1,
        size: endIndex - pointer + endMark.length
      });
      pointer = residualBuffer.indexOf(headerMark, endIndex);
    }
    return counter;
  };
  // PNG file detector
  const pngHeaderMark = Buffer.from("\x89PNG\x0d\x0a\x1a\x0a", "ascii");
  const pngEndMark = Buffer.from("IEND\xae\x42\x60\x82", "ascii");
  const pngCounter = findFilesInBuffer(pngHeaderMark, pngEndMark, "png");
  // JPG file detector
  const jpgHeaderMark = Buffer.from("\xff\xd8", "ascii");
  const jpgEndMark = Buffer.from("\xff\xd9", "ascii");
  const jpgCounter = findFilesInBuffer(jpgHeaderMark, jpgEndMark, "jpg");
  // TODO: detect more image formats
  // Print detected file list
  if (pngCounter > 0 || jpgCounter > 0) {
    console.log(
      `- Find ${pngCounter} un-indexed PNG file(s) and ${jpgCounter} un-indexed JPG file(s).`
    );
    console.log(
      `  > ${"temp file name".padEnd(50, " ")}\t${"offset".padEnd(
        10,
        " "
      )}\tsize\n  ${"".padStart(80, "=")}`
    );
    for (let config of unindexedList) {
      console.log(
        `  * ${config.name.padEnd(50, " ")}\t${formatHex(
          config.offset
        )}\t${formatHex(config.size)}`
      );
      let scopedName = "./unindexed" + config.name;
      try {
        fs.mkdirSync(path.dirname(scopedName), { recursive: true });
      } catch (e) {}
      // Due to the first byte is XOR key, therefore the actual offset is add by 1
      fs.writeFileSync(
        scopedName,
        xorBuffer.slice(config.offset + 1, config.offset + config.size + 1)
      );
    }
  }
}

// Print un-indexed data range
const unknownIndexLength =
  dataOffset -
  fileList.map(config => config.name.length + 12).reduce((p, v) => p + v, 0) -
  indexOffset;
if (unknownIndexLength > 0) {
  const missingRanges = [];
  let lastOffset = dataOffset;
  fileList.forEach(config => {
    if (config.offset > lastOffset) {
      missingRanges.push([lastOffset, config.offset]);
    }
    lastOffset = config.offset + config.size;
  });
  if (missingRanges.length === 0 && unknownIndexLength > 13) {
    fileList.unshift({
      name: "/".padEnd(unknownIndexLength - 12, "0"),
      offset: dataOffset - 1,
      size: 0
    });
    console.log(
      "- Missing empty file index, will automatically create an arbitrary index"
    );
  } else {
    console.log(
      `- Missing file index ${missingRanges
        .map(r => `from ${formatHex(r[0])} to ${formatHex(r[1])}`)
        .join(", ")}, maybe ${Math.round(unknownIndexLength / 30)} file(s)`
    );
  }
}

// Print parsed file list
console.log(`- Parsed file list(${fileList.length}):`);
console.log(
  `  > ${"file name".padEnd(50, " ")}\t${"offset".padEnd(
    10,
    " "
  )}\tsize\n  ${"".padStart(80, "=")}`
);
for (let config of fileList) {
  console.log(
    `  * ${config.name.padEnd(50, " ")}\t${formatHex(
      config.offset
    )}\t${formatHex(config.size)}`
  );
  let scopedName = "./restored" + config.name;
  try {
    fs.mkdirSync(path.dirname(scopedName), { recursive: true });
  } catch (e) {}
  // Due to the first byte is XOR key, therefore the actual offset is add by 1
  fs.writeFileSync(
    scopedName,
    xorBuffer.slice(config.offset + 1, config.offset + config.size + 1)
  );
}

// Reconstruct the wxapkg
const wxapkgBuffer = Buffer.allocUnsafe(xorBuffer.length - 1);
for (let i = 0; i < wxapkgBuffer.length; i++) {
  if (i < baseOffset - 1) {
    wxapkgBuffer[i] = 0;
  } else {
    wxapkgBuffer[i] = xorBuffer[i + 1];
  }
}
// Package structure, thanks to https://toutiao.io/posts/33fum8/preview
const reconstructBuffer = Buffer.allocUnsafe(wxapkgBuffer.length);
reconstructBuffer.writeUInt8(0xbe, 0); // Fixed header first byte
reconstructBuffer.writeUInt32BE(0x00000000, 1); // Edition
reconstructBuffer.writeUInt32BE(dataOffset - indexOffset, 5); // Index info length
reconstructBuffer.writeUInt32BE(xorBuffer.length - dataOffset, 9); // Body info length
reconstructBuffer.writeUInt8(0xed, 13); // Fixed header last mark
reconstructBuffer.writeUInt32BE(fileList.length, 14); // File count
let reconstructPointer = 18;
for (let config of fileList) {
  const nameBuffer = new TextEncoder("utf-8").encode(config.name);
  reconstructBuffer.writeUInt32BE(nameBuffer.length, reconstructPointer);
  reconstructPointer += 4;
  for (let i = 0; i < nameBuffer.length; i++) {
    reconstructBuffer[reconstructPointer++] = nameBuffer[i];
  }
  reconstructBuffer.writeUInt32BE(config.offset, reconstructPointer);
  reconstructPointer += 4;
  reconstructBuffer.writeUInt32BE(config.size, reconstructPointer);
  reconstructPointer += 4;
}
if (
  reconstructPointer < baseOffset - 1 ||
  !wxapkgBuffer
    .slice(baseOffset, reconstructPointer)
    .equals(reconstructBuffer.slice(baseOffset, reconstructPointer))
) {
  console.log(
    "- Fail to reconstruct the wxapkg file, will export partial result."
  );
  fs.writeFileSync("rec.wxapkg", reconstructBuffer);
} else {
  for (let i = 0; i < baseOffset; i++) {
    wxapkgBuffer[i] = reconstructBuffer[i];
  }
  console.log("- Successfully reconstruct the wxapkg file!");
}

// Export result wxapkg
fs.writeFileSync("decrypted.wxapkg", wxapkgBuffer);
