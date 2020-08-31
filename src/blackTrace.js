const pbkdf2 = require("pbkdf2");
const crypto = require("crypto");
const fs = require("fs");

const fileBuffer = fs.readFileSync("__APP__.wxapkg");
const AppName = "";

const salt = "saltiest";
const iv = Buffer.from("the iv: 16 bytes", "ascii");
const key = pbkdf2.pbkdf2Sync(AppName, salt, 1000, 32, "sha1");
const xorKey =
  AppName.length >= 2 ? AppName.charAt(AppName.length - 2).charCodeAt() : 0x66;

// decrypt head using AES-256-CBC
const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
decipher.setAutoPadding(false);
let decryptedHead = decipher.update(fileBuffer.slice(6, 0x406));
decryptedHead = Buffer.concat([decryptedHead, decipher.final()]);

// decrypt body using XOR
let decryptedBody = fileBuffer.slice(0x406);
for (let i = 0; i < decryptedBody.byteLength; i++) {
  decryptedBody[i] ^= xorKey;
}

// merge and check file format
let mergedDecrypted = Buffer.concat([
  decryptedHead.slice(0, 0x3ff),
  decryptedBody,
]);
if (
  mergedDecrypted.readUInt8(0) !== 0xbe ||
  mergedDecrypted.readUInt8(13) !== 0xed
) {
  console.log("Fail package validation, please check if AppName is correct1");
} else {
  console.log("Successfully decrypted the wxapkg file!");
  fs.writeFileSync("./decrypted.wxapkg", mergedDecrypted);
}
