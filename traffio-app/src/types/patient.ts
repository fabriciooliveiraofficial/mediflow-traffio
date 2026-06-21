// Traffio Medical - Centralized Type Definitions

// ─── Patient ───────────────────────────────────────────
export interface Patient {
    id: string;
    tenant_id: string;
    full_name: string;
    cpf: string | null;
    national_id?: string | null;
    national_id_type?: string | null;
    country?: string | null;
    email: string | null;
    phone: string | null;
    mobile?: string | null;
    birth_date: string | null;
    gender: string | null;
    address_json: Record<string, unknown> | null;
    type: 'particular' | 'insurance';
    insurance_provider: string | null;
    insurance_card: string | null;
    medical_notes: string | null;
    preferred_locale?: string | null;
    created_at: string;
    updated_at: string;
}

// ─── Appointment ───────────────────────────────────────
export type AppointmentStatus =
    | 'scheduled'
    | 'confirmed'
    | 'waiting'
    | 'in_progress'
    | 'completed'
    | 'canceled';

export interface Appointment {
    id: string;
    tenant_id: string;
    patient_id: string;
    doctor_id: string;
    type_id: string | null;
    date: string;
    start_time: string;
    end_time: string | null;
    status: AppointmentStatus;
    notes: string | null;
    created_at: string;
    updated_at: string;
    // Joined fields (optional, from queries)
    patient?: Pick<Patient, 'full_name' | 'mobile' | 'type' | 'insurance_provider'>;
}

// ─── Medical Records ───────────────────────────────────
export interface SoapNotes {
    s: string;
    o: string;
    a: string;
    p: string;
}

export interface MedicalRecord {
    id: string;
    tenant_id: string;
    patient_id: string;
    doctor_id: string;
    appointment_id: string | null;
    soap_notes: SoapNotes | null;
    content: string | null;
    attachments_json: Attachment[];
    created_at: string;
    updated_at: string;
}

export interface Prescription {
    id: string;
    medical_record_id: string;
    content_json: PrescriptionItem[];
    pdf_url: string | null;
    external_provider_id: string | null;
    created_at: string;
}

export interface PrescriptionItem {
    medication: string;
    dosage: string;
    frequency: string;
    duration: string;
    notes?: string;
}

export interface Attachment {
    name: string;
    url: string;
    type: 'pdf' | 'image' | 'lab_result';
    uploaded_at: string;
}

// ─── Timeline (Unified Feed) ──────────────────────────
export type TimelineEventType = 'consultation' | 'prescription' | 'exam_result';

export interface TimelineEvent {
    id: string;
    type: TimelineEventType;
    date: string;
    title: string;
    subtitle: string | null;
    data: MedicalRecord | Prescription | Attachment;
}

// ─── Queue (Realtime) ─────────────────────────────────
export type DoctorAvailability = 'on_time' | 'slight_delay' | 'moderate_delay';

export interface QueuePosition {
    position: number;
    total: number;
    estimatedWaitMinutes: number;
    doctorStatus: DoctorAvailability;
    currentPatientStartedAt: string | null;
}
