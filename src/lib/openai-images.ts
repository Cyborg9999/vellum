// OpenAI gpt-image-2 client: generate PNGs via the /v1/images/generations
// endpoint, edit reference images via /v1/images/edits, and persist results
// into the project's Library (mirrors the disk + DB layout used for clipboard
// pastes and drag-drop imports).

import { writeFile, mkdir, exists } from "@tauri-apps/plugin-fs";
import { appLocalDataDir, join } from "@tauri-apps/api/path";
import { getSetting, addRefImage } from "./db";
import type { RefImage, RefImageRole } from "./types";

export type ImageSize =
  | "auto"
  | "1024x1024"
  | "1536x1024"
  | "1024x1536"
  | "1792x1024" // 16:9
  | "1024x1792" // 9:16
  | "2048x1024" // 2:1
  | "1024x2048" // 1:2
  | "1536x1152" // 4:3
  | "1152x1536"; // 3:4
export type ImageQuality = "low" | "medium" | "high" | "auto";

export interface GenerateImageOptions {
  prompt: string;
  size?: ImageSize;
  quality?: ImageQuality;
}

interface OpenAIErrorBody {
  error?: { message?: string };
}

interface OpenAIImageResponse {
  data?: { b64_json?: string }[];
}

export async function generateImage(
  opts: GenerateImageOptions
): Promise<string> {
  const key = await getSetting("openai_api_key");
  if (!key || !key.trim()) {
    throw new Error("OpenAI API key not set. Open Settings to add one.");
  }

  const size: ImageSize = opts.size ?? "1024x1024";
  const quality: ImageQuality = opts.quality ?? "auto";

  const res = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key.trim()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-image-2",
      prompt: opts.prompt,
      n: 1,
      size,
      quality,
    }),
  });

  if (!res.ok) {
    if (res.status === 401) {
      throw new Error("Invalid OpenAI API key. Check Settings.");
    }
    if (res.status === 429) {
      throw new Error("OpenAI rate limit reached. Try again in a minute.");
    }
    if (res.status >= 500) {
      throw new Error(
        `OpenAI server error (status ${res.status}). Try again.`
      );
    }
    let detail = "";
    try {
      const body = (await res.json()) as OpenAIErrorBody;
      detail = body.error?.message ?? "";
    } catch {
      detail = await res.text().catch(() => "");
    }
    throw new Error(
      `OpenAI rejected the request: ${detail || `status ${res.status}`}`
    );
  }

  const json = (await res.json()) as OpenAIImageResponse;
  const b64 = json.data?.[0]?.b64_json;
  if (!b64) {
    throw new Error("OpenAI response missing image data (b64_json).");
  }
  return b64;
}

export interface EditImageOptions {
  sourceImage: Uint8Array | File | Blob;
  sourceImageName: string;
  prompt: string;
  size?: ImageSize;
  quality?: ImageQuality;
}

/**
 * Wrap raw bytes into a File so FormData carries a filename + MIME — OpenAI
 * needs both to accept the upload as an image part. Plain Blob without name
 * gets rejected as "unsupported file type" on the edits endpoint.
 */
export function uint8ArrayToFile(
  bytes: Uint8Array,
  filename: string,
  mime: string
): File {
  // Cast to BlobPart[] avoids a TS variance issue between Uint8Array<ArrayBufferLike>
  // and the File constructor's BlobPart[] signature in newer lib.dom.d.ts.
  return new File([bytes as BlobPart], filename, { type: mime });
}

export async function editImage(opts: EditImageOptions): Promise<string> {
  const key = await getSetting("openai_api_key");
  if (!key || !key.trim()) {
    throw new Error("OpenAI API key not set. Open Settings to add one.");
  }

  const size: ImageSize = opts.size ?? "1024x1024";
  const quality: ImageQuality = opts.quality ?? "auto";

  const fileForUpload: File | Blob =
    opts.sourceImage instanceof Uint8Array
      ? uint8ArrayToFile(opts.sourceImage, opts.sourceImageName, "image/png")
      : opts.sourceImage;

  const form = new FormData();
  form.append("model", "gpt-image-2");
  form.append("image", fileForUpload, opts.sourceImageName);
  form.append("prompt", opts.prompt);
  form.append("size", size);
  form.append("quality", quality);
  form.append("n", "1");

  // Intentionally NOT setting Content-Type — fetch must generate its own
  // multipart boundary, which requires the browser to own the header.
  const res = await fetch("https://api.openai.com/v1/images/edits", {
    method: "POST",
    headers: { Authorization: `Bearer ${key.trim()}` },
    body: form,
  });

  if (!res.ok) {
    if (res.status === 401) {
      throw new Error("Invalid OpenAI API key. Check Settings.");
    }
    if (res.status === 429) {
      throw new Error("OpenAI rate limit reached. Try again in a minute.");
    }
    if (res.status >= 500) {
      throw new Error(
        `OpenAI server error (status ${res.status}). Try again.`
      );
    }
    let detail = "";
    try {
      const body = (await res.json()) as OpenAIErrorBody;
      detail = body.error?.message ?? "";
    } catch {
      detail = await res.text().catch(() => "");
    }
    throw new Error(
      `OpenAI rejected the edit: ${detail || `status ${res.status}`}`
    );
  }

  const json = (await res.json()) as OpenAIImageResponse;
  const b64 = json.data?.[0]?.b64_json;
  if (!b64) {
    throw new Error("OpenAI edit response missing image data (b64_json).");
  }
  return b64;
}

export interface SaveGeneratedImageInput {
  projectId: number;
  prompt: string;
  base64: string;
  role?: RefImageRole;
}

export async function saveGeneratedImageToLibrary(
  input: SaveGeneratedImageInput
): Promise<RefImage> {
  const binary = atob(input.base64);
  const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));

  const baseDir = await appLocalDataDir();
  const generatedDir = await join(baseDir, "generated");
  if (!(await exists(generatedDir))) {
    await mkdir(generatedDir, { recursive: true });
  }

  const stamp = formatTimestamp(new Date());
  const rand = Math.random().toString(36).slice(2, 8);
  const filename = `gen-${stamp}-${rand}.png`;
  const fullPath = await join(generatedDir, filename);

  await writeFile(fullPath, bytes);

  return addRefImage({
    project_id: input.projectId,
    role: input.role ?? "character",
    name: input.prompt.slice(0, 60),
    file_path: fullPath,
    file_size: bytes.length,
    source: "generated",
  });
}

function formatTimestamp(d: Date): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  );
}
