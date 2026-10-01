import type { PatientAttachment, PatientRecord, ShiftDetails } from "../types";

interface ExtractionResponse {
  engine?: string;
  model?: string;
  patients?: PatientRecord[];
  error?: string;
}

export async function extractPatientsWithAi(
  sourceText: string,
  sourceId: string,
  patientLabel: string,
  shiftContext?: ShiftDetails,
  templateProfile?: string,
  templateInstructions?: string,
  templateContract?: unknown,
  media: PatientAttachment[] = [],
): Promise<PatientRecord[]> {
  const response = await fetch("/api/clinical/extract", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sourceText, sourceId, patientLabel, shiftContext, templateProfile, templateInstructions, templateContract, media }),
  });
  let payload: ExtractionResponse = {};
  try {
    payload = await response.json() as ExtractionResponse;
  } catch {
    throw new Error(`AI backend mengembalikan response yang tidak valid (HTTP ${response.status}).`);
  }
  if (!response.ok) throw new Error(payload.error || `AI backend gagal (HTTP ${response.status}).`);
  if (!Array.isArray(payload.patients) || !payload.patients.length) {
    throw new Error("AI agent tidak menemukan record pasien dari source tersebut.");
  }
  return payload.patients;
}
