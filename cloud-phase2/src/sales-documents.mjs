export const MAX_TELEGRAM_DOWNLOAD_BYTES = 20 * 1024 * 1024;

const ACCEPTED_TYPES = {
  ".pdf": ["application/pdf"],
  ".docx": ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  ".pptx": ["application/vnd.openxmlformats-officedocument.presentationml.presentation"],
  ".txt": ["text/plain"],
  ".md": ["text/markdown", "text/plain"],
  ".csv": ["text/csv", "application/csv", "text/plain", "application/vnd.ms-excel"]
};

const GENERIC_MIME_TYPES = new Set(["", "application/octet-stream", "binary/octet-stream"]);

function cleanText(value, maxLength) {
  return String(value || "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

/**
 * Validate Telegram document metadata without downloading the file.
 * File bytes remain on Telegram for now; file_id is stored privately in D1
 * and can be used to request a fresh download URL when extraction is added.
 */
export function validateSalesDocument(document, caption = "") {
  if (!document || typeof document !== "object") {
    return { ok: false, error: "I couldn't identify an attached document." };
  }

  const fileId = String(document.file_id || "").trim();
  const uniqueId = String(document.file_unique_id || "").trim();
  if (!fileId || fileId.length > 1024 || !uniqueId || uniqueId.length > 256) {
    return { ok: false, error: "Telegram did not provide valid document identifiers." };
  }

  const rawName = String(document.file_name || "").replace(/\\/g, "/").split("/").pop() || "";
  const fileName = cleanText(rawName, 200);
  const dot = fileName.lastIndexOf(".");
  const extension = dot >= 0 ? fileName.slice(dot).toLowerCase() : "";
  if (!fileName || !ACCEPTED_TYPES[extension]) {
    return { ok: false, error: "Supported product documents are PDF, DOCX, PPTX, TXT, MD, and CSV." };
  }

  const mimeType = cleanText(document.mime_type || "", 120).toLowerCase();
  if (!GENERIC_MIME_TYPES.has(mimeType) && !ACCEPTED_TYPES[extension].includes(mimeType)) {
    return { ok: false, error: "The file type does not match its filename. Please upload a correctly named document." };
  }

  const fileSize = document.file_size == null ? null : Number(document.file_size);
  if (fileSize !== null && (!Number.isSafeInteger(fileSize) || fileSize < 1 || fileSize > MAX_TELEGRAM_DOWNLOAD_BYTES)) {
    return { ok: false, error: "The document must be between 1 byte and 20 MB." };
  }

  return {
    ok: true,
    document: {
      fileId,
      fileUniqueId: uniqueId,
      fileName,
      mimeType: mimeType || "application/octet-stream",
      fileSizeBytes: fileSize,
      caption: cleanText(caption, 500)
    }
  };
}
