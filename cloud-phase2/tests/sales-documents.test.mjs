import test from "node:test";
import assert from "node:assert/strict";
import { MAX_TELEGRAM_DOWNLOAD_BYTES, validateSalesDocument } from "../src/sales-documents.mjs";

const base = {
  file_id: "telegram-file-id",
  file_unique_id: "telegram-unique-id",
  file_name: "Product.pdf",
  mime_type: "application/pdf",
  file_size: 1024
};

test("accepts a supported PDF and preserves its caption", () => {
  const result = validateSalesDocument(base, "Please analyze this product.");
  assert.equal(result.ok, true);
  assert.equal(result.document.fileName, "Product.pdf");
  assert.equal(result.document.caption, "Please analyze this product.");
  assert.equal(result.document.fileSizeBytes, 1024);
});

test("accepts supported office and text formats", () => {
  for (const [file_name, mime_type] of [
    ["Product.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
    ["Pitch.pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"],
    ["Notes.txt", "text/plain"],
    ["Notes.md", "text/markdown"],
    ["Leads.csv", "text/csv"]
  ]) {
    assert.equal(validateSalesDocument({ ...base, file_name, mime_type }).ok, true, file_name);
  }
});

test("rejects unsupported extensions and mismatched MIME types", () => {
  assert.equal(validateSalesDocument({ ...base, file_name: "program.exe" }).ok, false);
  assert.equal(validateSalesDocument({ ...base, mime_type: "image/png" }).ok, false);
});

test("rejects missing Telegram identifiers", () => {
  assert.equal(validateSalesDocument({ ...base, file_id: "" }).ok, false);
  assert.equal(validateSalesDocument({ ...base, file_unique_id: "" }).ok, false);
});

test("rejects empty, invalid, and over-limit file sizes", () => {
  assert.equal(validateSalesDocument({ ...base, file_size: 0 }).ok, false);
  assert.equal(validateSalesDocument({ ...base, file_size: -1 }).ok, false);
  assert.equal(validateSalesDocument({ ...base, file_size: MAX_TELEGRAM_DOWNLOAD_BYTES + 1 }).ok, false);
  assert.equal(validateSalesDocument({ ...base, file_size: 1.5 }).ok, false);
});

test("sanitizes paths and control characters in filenames and captions", () => {
  const result = validateSalesDocument({
    ...base,
    file_name: "../../Product.pdf"
  }, "Product\nnotes");
  assert.equal(result.ok, true);
  assert.equal(result.document.fileName, "Product.pdf");
  assert.equal(result.document.caption, "Product notes");
});

test("allows missing size metadata but never treats it as zero", () => {
  const result = validateSalesDocument({ ...base, file_size: undefined });
  assert.equal(result.ok, true);
  assert.equal(result.document.fileSizeBytes, null);
});
