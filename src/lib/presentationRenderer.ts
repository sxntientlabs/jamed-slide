export interface RenderedPresentation {
  engine: string;
  slideCount: number;
  slides: string[];
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, Math.min(index + chunkSize, bytes.length)));
  }
  return btoa(binary);
}

export async function renderPresentationForPreview(blob: Blob): Promise<RenderedPresentation> {
  const response = await fetch("/api/presentation/render", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pptxBase64: arrayBufferToBase64(await blob.arrayBuffer()) }),
  });
  let payload: Partial<RenderedPresentation> & { error?: string } = {};
  try {
    payload = await response.json() as Partial<RenderedPresentation> & { error?: string };
  } catch {
    throw new Error(`Preview visual mengembalikan response tidak valid (HTTP ${response.status}).`);
  }
  if (!response.ok) throw new Error(payload.error || `Preview visual gagal (HTTP ${response.status}).`);
  if (!Array.isArray(payload.slides) || !payload.slides.length) throw new Error("Preview visual tidak menghasilkan slide.");
  return {
    engine: payload.engine || "server renderer",
    slideCount: payload.slideCount || payload.slides.length,
    slides: payload.slides,
  };
}
