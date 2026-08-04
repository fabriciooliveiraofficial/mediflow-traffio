// Contrato único de leitura para prescriptions.content_json.
//
// Historicamente este campo foi gravado em 3 formatos incompatíveis:
//   1. { medications: [{ name, dosage, instructions }] }   — NewPrescriptionModal (atual)
//   2. { content, patient_name, date }                     — editor de texto livre do MedicalRecordsHub (legado)
//   3. [{ medication, dosage, frequency, duration, notes }] — contrato antigo de types/patient.ts (legado)
//
// normalizePrescriptionContent lê qualquer um dos três e devolve sempre a mesma forma,
// para que ViewPrescriptionModal, MedicalRecordsHub e usePatientTimeline nunca mais
// precisem saber qual formato originou o registro.

export interface PrescriptionMedication {
    name: string;
    dosage: string;
    instructions: string;
}

export interface NormalizedPrescription {
    medications: PrescriptionMedication[];
    freeText: string | null;
}

export function normalizePrescriptionContent(raw: unknown): NormalizedPrescription {
    if (!raw || typeof raw !== 'object') return { medications: [], freeText: null };
    const obj = raw as Record<string, any>;

    // Formato atual: { medications: [...] }
    if (Array.isArray(obj.medications)) {
        return {
            medications: obj.medications.map((m: any) => ({
                name: m.name || m.medication || '',
                dosage: m.dosage || '',
                instructions: m.instructions || [m.frequency, m.duration].filter(Boolean).join(' · '),
            })),
            freeText: typeof obj.freeText === 'string' ? obj.freeText : null,
        };
    }

    // Legado: editor de texto livre do MedicalRecordsHub
    if (typeof obj.content === 'string') {
        return { medications: [], freeText: obj.content };
    }

    if (typeof obj.freeText === 'string') {
        return { medications: [], freeText: obj.freeText };
    }

    // Legado: array direto no formato antigo de types/patient.ts
    if (Array.isArray(raw)) {
        return {
            medications: (raw as any[]).map((m) => ({
                name: m.medication || m.name || '',
                dosage: m.dosage || '',
                instructions: [m.frequency, m.duration, m.notes].filter(Boolean).join(' · '),
            })),
            freeText: null,
        };
    }

    return { medications: [], freeText: null };
}

/** Resumo curto para listas (card da timeline, lista de receitas). */
export function prescriptionSummary(raw: unknown): string {
    const { medications, freeText } = normalizePrescriptionContent(raw);
    if (medications.length > 0) {
        return medications.map((m) => m.name).filter(Boolean).join(', ');
    }
    if (freeText) return freeText.slice(0, 80);
    return '';
}
