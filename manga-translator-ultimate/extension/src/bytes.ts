import { imageLimit } from './types';

export async function responseBlob(response: Response, limit = imageLimit): Promise<Blob> {
  if (!response.ok || !response.body) throw new Error('Máy chủ ảnh từ chối yêu cầu.');
  if (Number(response.headers.get('content-length')) > limit) throw new Error('Ảnh vượt quá dung lượng cho phép.');
  const reader = response.body.getReader();
  const pieces: Uint8Array<ArrayBuffer>[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) throw new Error('Ảnh vượt quá dung lượng cho phép.');
      pieces.push(new Uint8Array(value));
    }
  } finally {
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  return new Blob(pieces, { type: response.headers.get('content-type') || 'application/octet-stream' });
}

export async function base64(blob: Blob): Promise<string> {
  if (blob.size > imageLimit) throw new Error('Ảnh vượt quá 21 MiB.');
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const pieces: string[] = [];
  for (let i = 0; i < bytes.length; i += 0x8000) pieces.push(String.fromCharCode(...bytes.subarray(i, i+0x8000)));
  return btoa(pieces.join(''));
}

export function pngBlob(data: string): Blob {
  const bytes = Uint8Array.from(atob(data), letter => letter.charCodeAt(0));
  return new Blob([bytes], {type: 'image/png'});
}
